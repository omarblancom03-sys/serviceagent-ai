-- US-22: el administrador elige el modo de pago del restaurante, y con él cuándo va el pedido a
-- cocina (docs/negocio.md → Estados del pedido, D55):
--   'al_recoger'    → se paga en caja al recoger; el pedido va a cocina al confirmarse
--                     (modo_envio_cocina = al_confirmar, D46). Es el de hoy y el valor inicial.
--   'transferencia' → se paga antes por transferencia; el pedido queda en 'esperando_pago' y va a
--                     cocina hasta que se confirme el pago (modo_envio_cocina = al_pagar, US-25).

-- 1. Configuración del restaurante: una sola fila (la llave solo puede ser true).
create table public.configuracion_restaurante (
  id boolean primary key default true check (id),
  modo_pago text not null default 'al_recoger' check (modo_pago in ('al_recoger', 'transferencia')),
  -- Último cambio: quién y cuándo. Vacío mientras nadie lo haya cambiado.
  id_empleado uuid references public.empleados (id),
  actualizado_en timestamptz not null default now()
);

insert into public.configuracion_restaurante (id) values (true);

comment on table public.configuracion_restaurante is
  'Configuración del restaurante (una sola fila). Solo la API la lee y la cambia.';

revoke all on table public.configuracion_restaurante from anon, authenticated, service_role;
grant select on table public.configuracion_restaurante to service_role;
-- Las funciones de abajo corren con los permisos de quien las llama (service_role): cambiar_modo_pago
-- actualiza la fila, y bloquearla (`for update` y el `for share` de crear_pedido) también exige
-- permiso de update. La API la cambia solo con cambiar_modo_pago, que deja el historial.
grant update (modo_pago, id_empleado, actualizado_en) on table public.configuracion_restaurante to service_role;
alter table public.configuracion_restaurante enable row level security;

-- 2. Cada cambio de modo: quién, a qué modo y cuándo.
create table public.historial_modo_pago (
  id_cambio integer generated always as identity primary key,
  modo_pago text not null check (modo_pago in ('al_recoger', 'transferencia')),
  id_empleado uuid not null references public.empleados (id),
  creado_en timestamptz not null default now()
);

comment on table public.historial_modo_pago is 'Cambios del modo de pago. Solo la API la lee y escribe.';

revoke all on table public.historial_modo_pago from anon, authenticated, service_role;
grant select, insert on table public.historial_modo_pago to service_role;
alter table public.historial_modo_pago enable row level security;

-- 3. Cada pedido guarda el modo con que se creó: cambiar el modo no afecta a los que ya existen.
--    Los pedidos de antes de esta migración se crearon con pago al recoger.
alter table public.pedidos
  add column modo_pago text not null default 'al_recoger'
  check (modo_pago in ('al_recoger', 'transferencia'));

-- 4. Cambia el modo y guarda el cambio, en una transacción. La fila se bloquea (`for update`) para
--    que dos administradores a la vez no dejen el historial desordenado (D14). Si el modo ya era
--    ese, no cambia nada ni deja historial.
create function public.cambiar_modo_pago(p_modo_pago text, p_id_empleado uuid)
returns table (modo_pago text, actualizado_en timestamptz, cambio boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_actual text;
begin
  select c.modo_pago into v_actual from public.configuracion_restaurante c for update;

  if v_actual = p_modo_pago then
    return query
    select c.modo_pago, c.actualizado_en, false from public.configuracion_restaurante c;
    return;
  end if;

  -- El `where` es la única fila; Supabase rechaza un update sin `where` (extensión safeupdate).
  update public.configuracion_restaurante c
  set modo_pago = p_modo_pago, id_empleado = p_id_empleado, actualizado_en = now()
  where c.id;

  insert into public.historial_modo_pago (modo_pago, id_empleado, creado_en)
  values (p_modo_pago, p_id_empleado, now());

  return query
  select c.modo_pago, c.actualizado_en, true from public.configuracion_restaurante c;
end;
$$;

revoke execute on function public.cambiar_modo_pago(text, uuid) from public, anon, authenticated;
grant execute on function public.cambiar_modo_pago(text, uuid) to service_role;

-- 5. crear_pedido lee el modo dentro de su transacción y devuelve con qué modo quedó el pedido.
--    Mismos parámetros, reglas de duplicados y de total que en 20261015100000; como cambia lo que
--    devuelve (se agrega modo_pago), hay que borrarla y crearla de nuevo con sus permisos.
drop function public.crear_pedido(text, text, text, integer, jsonb, integer);

create function public.crear_pedido(
  p_nombre_cliente text,
  p_telefono text,
  p_huella text,
  p_total_centavos integer,
  p_renglones jsonb,
  p_minutos_duplicado integer
)
returns table (
  folio_asignado integer,
  total_guardado integer,
  estado_actual text,
  ya_existia boolean,
  modo_pago text
)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_folio integer;
  v_total integer;
  v_estado text;
  v_modo text;
  v_renglon jsonb;
  v_extra jsonb;
  v_id_renglon integer;
begin
  perform pg_advisory_xact_lock(hashtext('crear_pedido:' || p_telefono));

  -- Un duplicado devuelve el pedido que ya existía, con el modo con que se creó (D34).
  select p.folio, p.total_centavos, p.estado, p.modo_pago into v_folio, v_total, v_estado, v_modo
  from public.pedidos p
  where p.telefono = p_telefono
    and p.huella = p_huella
    and p.estado <> 'cancelado'
    and p.creado_en > now() - make_interval(mins => p_minutos_duplicado)
  order by p.creado_en desc
  limit 1;
  if found then
    return query select v_folio, v_total, v_estado, true, v_modo;
    return;
  end if;

  -- El modo vigente decide a dónde va el pedido (D55). `for share` espera a un cambio de modo que
  -- esté en curso, así el pedido nunca se guarda con un modo a medio cambiar.
  select c.modo_pago into v_modo from public.configuracion_restaurante c for share;
  v_estado := case when v_modo = 'transferencia' then 'esperando_pago' else 'en_cola' end;

  insert into public.pedidos (
    nombre_cliente, telefono, huella, total_centavos, estado, modo_pago, creado_en
  )
  values (p_nombre_cliente, p_telefono, p_huella, p_total_centavos, v_estado, v_modo, now())
  returning id_pedido, folio into v_id_pedido, v_folio;

  -- El historial guarda los dos pasos con la misma hora (D42): confirmado y en_cola, o
  -- confirmado y esperando_pago.
  insert into public.historial_estado_pedido (id_pedido, estado, creado_en)
  values (v_id_pedido, 'confirmado', now()), (v_id_pedido, v_estado, now());

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

  return query select v_folio, p_total_centavos, v_estado, false, v_modo;
end;
$$;

revoke execute on function public.crear_pedido(text, text, text, integer, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.crear_pedido(text, text, text, integer, jsonb, integer)
  to service_role;
