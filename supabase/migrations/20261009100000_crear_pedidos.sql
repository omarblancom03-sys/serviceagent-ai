-- US-08-P1: pedidos confirmados por el agente (docs/negocio.md → Estados del pedido).
--
-- Cada renglón guarda el nombre y el precio del momento (D35): si mañana cambia un precio o un
-- nombre del menú, el pedido de hoy sigue diciendo lo que se cobró. Los ids apuntan al menú para
-- cocina, inventario y reportes.

-- Folio que ve el cliente: consecutivo desde 1001 y nunca se repite (D33).
create sequence public.pedidos_folio_seq start with 1001;

create table public.pedidos (
  id_pedido integer generated always as identity primary key,
  folio integer not null unique default nextval('public.pedidos_folio_seq'),
  nombre_cliente text not null check (length(trim(nombre_cliente)) between 2 and 60),
  -- 10 dígitos de México, ya normalizado por la API (D32).
  telefono text not null check (telefono ~ '^[0-9]{10}$'),
  estado text not null default 'confirmado' check (
    estado in (
      'confirmado', 'esperando_pago', 'en_cola', 'preparando',
      'listo', 'entregado', 'cancelado', 'expirado'
    )
  ),
  total_centavos integer not null check (total_centavos > 0),
  -- SHA-256 de lo que se pidió, ya resuelto (ids, cantidades, extras, ingredientes): detecta el
  -- mismo pedido mandado dos veces (D34).
  huella text not null check (huella ~ '^[0-9a-f]{64}$'),
  creado_en timestamptz not null default now()
);

alter sequence public.pedidos_folio_seq owned by public.pedidos.folio;

create index pedidos_telefono_creado_en on public.pedidos (telefono, creado_en desc);

comment on table public.pedidos is 'Pedidos confirmados por el cliente. Solo la API la lee y escribe.';

-- Cada cambio de estado con su hora exacta (se usa para el tiempo estimado que aprende).
create table public.historial_estado_pedido (
  id_historial integer generated always as identity primary key,
  id_pedido integer not null references public.pedidos (id_pedido) on delete cascade,
  estado text not null check (
    estado in (
      'confirmado', 'esperando_pago', 'en_cola', 'preparando',
      'listo', 'entregado', 'cancelado', 'expirado'
    )
  ),
  creado_en timestamptz not null default now()
);

create index historial_estado_pedido_id_pedido on public.historial_estado_pedido (id_pedido);

-- Un renglón es un platillo (con su variante) o un extra suelto, igual que en la cotización.
create table public.renglones_pedido (
  id_renglon integer generated always as identity primary key,
  id_pedido integer not null references public.pedidos (id_pedido) on delete cascade,
  -- Orden en que se pidió (0, 1, 2…): platillos primero y luego extras sueltos.
  posicion integer not null check (posicion >= 0),
  tipo text not null check (tipo in ('platillo', 'extra')),
  id_platillo integer references public.platillo (id_platillo),
  id_variante integer references public.variante_producto (id_variante),
  id_extra integer references public.extra (id_extra),
  nombre text not null,
  -- null si el platillo solo tiene la variante "Único" (igual que en la cotización).
  variante text,
  cantidad integer not null check (cantidad between 1 and 20),
  sin_ingredientes text[] not null default '{}',
  precio_unitario_centavos integer not null check (precio_unitario_centavos >= 0),
  subtotal_centavos integer not null check (subtotal_centavos >= 0),
  unique (id_pedido, posicion),
  check (
    (tipo = 'platillo' and id_platillo is not null and id_variante is not null and id_extra is null)
    or (tipo = 'extra' and id_extra is not null and id_platillo is null and id_variante is null)
  )
);

-- Extras de un platillo (hoy solo Espuelas), con la cantidad por unidad del platillo.
create table public.extras_renglon_pedido (
  id_extra_renglon integer generated always as identity primary key,
  id_renglon integer not null references public.renglones_pedido (id_renglon) on delete cascade,
  id_extra integer not null references public.extra (id_extra),
  nombre text not null,
  cantidad integer not null check (cantidad between 1 and 20),
  precio_unitario_centavos integer not null check (precio_unitario_centavos >= 0)
);

create index renglones_pedido_id_pedido on public.renglones_pedido (id_pedido);
create index extras_renglon_pedido_id_renglon on public.extras_renglon_pedido (id_renglon);

-- Permisos explícitos (supabase/CLAUDE.md): solo la API, con service_role, lee y crea pedidos.
-- Cambiar el estado (cocina, caja, cancelar) llega con sus historias y su propio grant.
revoke all on table public.pedidos from anon, authenticated, service_role;
revoke all on table public.historial_estado_pedido from anon, authenticated, service_role;
revoke all on table public.renglones_pedido from anon, authenticated, service_role;
revoke all on table public.extras_renglon_pedido from anon, authenticated, service_role;
grant select, insert on table public.pedidos to service_role;
grant select, insert on table public.historial_estado_pedido to service_role;
grant select, insert on table public.renglones_pedido to service_role;
grant select, insert on table public.extras_renglon_pedido to service_role;
-- El folio sale de una secuencia normal (no identity): el insert necesita usarla.
revoke all on sequence public.pedidos_folio_seq from anon, authenticated, service_role;
grant usage on sequence public.pedidos_folio_seq to service_role;

alter table public.pedidos enable row level security;
alter table public.historial_estado_pedido enable row level security;
alter table public.renglones_pedido enable row level security;
alter table public.extras_renglon_pedido enable row level security;

-- Guarda un pedido completo en una sola transacción: el pedido, su primer estado ('confirmado'),
-- sus renglones y los extras de cada renglón. Si algo falla, no queda nada a medias.
--
-- Duplicados (D34): si el mismo teléfono ya tiene un pedido con la misma huella creado hace menos
-- de p_minutos_duplicado minutos (y no cancelado), no crea otro y devuelve ese folio, su total y
-- su estado actual con ya_existia = true. El candado por teléfono hace que dos llamadas iguales
-- al mismo tiempo esperen una a la otra en lugar de crear dos pedidos.
--
-- p_renglones es la lista que arma la API desde la cotización (services/pedido.ts):
--   [{ posicion, tipo, id_platillo, id_variante, id_extra, nombre, variante, cantidad,
--      sin_ingredientes: [..], precio_unitario_centavos, subtotal_centavos,
--      extras: [{ id_extra, nombre, cantidad, precio_unitario_centavos }] }]
-- Como segunda barrera, la suma de los subtotales debe ser igual a p_total_centavos.
create function public.crear_pedido(
  p_nombre_cliente text,
  p_telefono text,
  p_huella text,
  p_total_centavos integer,
  p_renglones jsonb,
  p_minutos_duplicado integer,
  p_ahora timestamptz default now()
)
returns table (
  folio_asignado integer, total_guardado integer, estado_actual text, ya_existia boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_folio integer;
  v_total integer;
  v_estado text;
  v_renglon jsonb;
  v_extra jsonb;
  v_id_renglon integer;
begin
  perform pg_advisory_xact_lock(hashtext('crear_pedido:' || p_telefono));

  select p.folio, p.total_centavos, p.estado into v_folio, v_total, v_estado
  from public.pedidos p
  where p.telefono = p_telefono
    and p.huella = p_huella
    and p.estado <> 'cancelado'
    and p.creado_en > p_ahora - make_interval(mins => p_minutos_duplicado)
  order by p.creado_en desc
  limit 1;
  if found then
    return query select v_folio, v_total, v_estado, true;
    return;
  end if;

  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, creado_en)
  values (p_nombre_cliente, p_telefono, p_huella, p_total_centavos, p_ahora)
  returning id_pedido, folio into v_id_pedido, v_folio;

  insert into public.historial_estado_pedido (id_pedido, estado, creado_en)
  values (v_id_pedido, 'confirmado', p_ahora);

  for v_renglon in select r.valor from jsonb_array_elements(p_renglones) as r(valor) loop
    insert into public.renglones_pedido (
      id_pedido, posicion, tipo, id_platillo, id_variante, id_extra, nombre, variante, cantidad,
      sin_ingredientes, precio_unitario_centavos, subtotal_centavos
    )
    values (
      v_id_pedido,
      (v_renglon ->> 'posicion')::integer,
      v_renglon ->> 'tipo',
      (v_renglon ->> 'id_platillo')::integer,
      (v_renglon ->> 'id_variante')::integer,
      (v_renglon ->> 'id_extra')::integer,
      v_renglon ->> 'nombre',
      v_renglon ->> 'variante',
      (v_renglon ->> 'cantidad')::integer,
      array(
        select jsonb_array_elements_text(coalesce(v_renglon -> 'sin_ingredientes', '[]'::jsonb))
      ),
      (v_renglon ->> 'precio_unitario_centavos')::integer,
      (v_renglon ->> 'subtotal_centavos')::integer
    )
    returning id_renglon into v_id_renglon;

    for v_extra in
      select e.valor from jsonb_array_elements(coalesce(v_renglon -> 'extras', '[]'::jsonb)) as e(valor)
    loop
      insert into public.extras_renglon_pedido (
        id_renglon, id_extra, nombre, cantidad, precio_unitario_centavos
      )
      values (
        v_id_renglon,
        (v_extra ->> 'id_extra')::integer,
        v_extra ->> 'nombre',
        (v_extra ->> 'cantidad')::integer,
        (v_extra ->> 'precio_unitario_centavos')::integer
      );
    end loop;
  end loop;

  select sum(r.subtotal_centavos) into v_total
  from public.renglones_pedido r
  where r.id_pedido = v_id_pedido;
  if v_total is distinct from p_total_centavos then
    raise exception 'El total (%) no coincide con la suma de los renglones (%).',
      p_total_centavos, v_total;
  end if;

  return query select v_folio, p_total_centavos, 'confirmado'::text, false;
end;
$$;

-- Postgres deja ejecutar funciones a PUBLIC por defecto: se quita y solo la API puede llamarla.
revoke execute on function public.crear_pedido(text, text, text, integer, jsonb, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.crear_pedido(text, text, text, integer, jsonb, integer, timestamptz)
  to service_role;
