-- US-23: el pedido guarda cómo va a pagar el cliente y, con transferencia, su referencia única
-- (docs/negocio.md → Pagos, D76).
--
-- Los métodos que se ofrecen salen del modo de pago del restaurante (D55):
--   'al_recoger'    → efectivo o tarjeta, en caja al recoger;
--   'transferencia' → solo transferencia, antes de que el pedido vaya a cocina (US-25).
--
-- 1. configuracion_restaurante.clabe_transferencia: la CLABE (ficticia) a la que se transfiere. Es
--    la única fuente: el agente la dicta y US-25 la compara con la `clabeDestino` del aviso (D70).
-- 2. pedidos: metodo_pago (el que eligió el cliente), referencia_pago (solo con transferencia,
--    única) y datos_whatsapp_pedidos_en (el cliente pidió los datos por WhatsApp; el envío llega
--    con US-28).
-- 3. crear_pedido recibe el método y, con transferencia, genera la referencia en la misma
--    transacción. Devuelve método, referencia y CLABE.
-- 4. pedir_datos_whatsapp: marca que el cliente pidió los datos de pago por WhatsApp.

-- 1. CLABE del restaurante. 999 no es el código de ningún banco y el dígito verificador no cuadra:
--    no puede ser una cuenta real.
alter table public.configuracion_restaurante
  add column clabe_transferencia text not null default '999180157000000005'
  check (clabe_transferencia ~ '^[0-9]{18}$');

comment on column public.configuracion_restaurante.clabe_transferencia is
  'CLABE ficticia para pagos por transferencia (D76). La dicta el agente y la revisa US-25.';

-- 2. Método, referencia y pedido de WhatsApp. Los pedidos anteriores quedan sin método (null).
alter table public.pedidos
  add column metodo_pago text check (metodo_pago in ('efectivo', 'tarjeta', 'transferencia')),
  add column referencia_pago text unique check (referencia_pago ~ '^GRN-[0-9]+-[A-Z0-9]{2}$'),
  add column datos_whatsapp_pedidos_en timestamptz,
  -- Con transferencia siempre hay referencia; con otro método, nunca.
  add constraint pedidos_referencia_con_transferencia check (
    case when metodo_pago = 'transferencia' then referencia_pago is not null
      else referencia_pago is null end
  );

comment on column public.pedidos.metodo_pago is 'Cómo dijo el cliente que va a pagar (US-23, D76).';
comment on column public.pedidos.referencia_pago is
  'Referencia única de la transferencia: GRN-<folio>-<2 caracteres al azar> (D76).';
comment on column public.pedidos.datos_whatsapp_pedidos_en is
  'Cuándo pidió el cliente los datos de pago por WhatsApp. El envío llega con US-28.';

-- pedir_datos_whatsapp actualiza solo esa columna.
grant update (datos_whatsapp_pedidos_en) on table public.pedidos to service_role;

-- 3. crear_pedido con método. Mismas reglas de duplicados y total que en 20261021120000; como
--    cambian los parámetros y lo que devuelve, se borra y se crea de nuevo con sus permisos.
--    El método lo revisa antes la API contra el modo; aquí se vuelve a revisar con el modo que se
--    lee dentro de la transacción (por si el admin lo cambió en medio):
--      - modo 'transferencia': el método siempre es 'transferencia', llegue lo que llegue;
--      - modo 'al_recoger': tiene que ser 'efectivo' o 'tarjeta', o falla (la API responde 500 y
--        el agente reintenta; con el modo nuevo, la API ya pide el método correcto).
drop function public.crear_pedido(text, text, text, integer, jsonb, integer);

create function public.crear_pedido(
  p_nombre_cliente text,
  p_telefono text,
  p_huella text,
  p_total_centavos integer,
  p_renglones jsonb,
  p_minutos_duplicado integer,
  p_metodo_pago text
)
returns table (
  folio_asignado integer,
  total_guardado integer,
  estado_actual text,
  ya_existia boolean,
  modo_pago text,
  metodo_pago text,
  referencia_pago text,
  clabe_transferencia text
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
  v_metodo text;
  v_referencia text;
  v_clabe text;
  v_renglon jsonb;
  v_extra jsonb;
  v_id_renglon integer;
  -- Sin 0/O, 1/I/L, 2/Z, 5/S ni 8/B: que no se confundan al dictarlos.
  v_alfabeto constant text := 'ACDEFGHJKMNPQRTUVWXY34679';
begin
  perform pg_advisory_xact_lock(hashtext('crear_pedido:' || p_telefono));

  -- `for share` espera a un cambio de modo que esté en curso (D55).
  select c.modo_pago, c.clabe_transferencia into v_modo, v_clabe
  from public.configuracion_restaurante c for share;

  -- Un duplicado devuelve el pedido que ya existía, con su modo, método y referencia (D34).
  select p.folio, p.total_centavos, p.estado, p.modo_pago, p.metodo_pago, p.referencia_pago
  into v_folio, v_total, v_estado, v_modo, v_metodo, v_referencia
  from public.pedidos p
  where p.telefono = p_telefono
    and p.huella = p_huella
    and p.estado <> 'cancelado'
    and p.creado_en > now() - make_interval(mins => p_minutos_duplicado)
  order by p.creado_en desc
  limit 1;
  if found then
    return query select v_folio, v_total, v_estado, true, v_modo, v_metodo, v_referencia,
      case when v_referencia is null then null else v_clabe end;
    return;
  end if;

  if v_modo = 'transferencia' then
    v_metodo := 'transferencia';
    v_estado := 'esperando_pago';
  elsif p_metodo_pago in ('efectivo', 'tarjeta') then
    v_metodo := p_metodo_pago;
    v_estado := 'en_cola';
  else
    raise exception 'Con pago al recoger el método es efectivo o tarjeta (llegó %).', p_metodo_pago;
  end if;

  -- El folio se toma antes del insert porque la referencia lo lleva (así es única) y tiene que
  -- existir al insertar (pedidos_referencia_con_transferencia). Los dos caracteres al azar evitan
  -- que alguien adivine la referencia de otro pedido con solo conocer su folio.
  v_folio := nextval('public.pedidos_folio_seq');
  if v_metodo = 'transferencia' then
    v_referencia := 'GRN-' || v_folio || '-'
      || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::integer, 1)
      || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::integer, 1);
  end if;

  insert into public.pedidos (
    folio, nombre_cliente, telefono, huella, total_centavos, estado, modo_pago, metodo_pago,
    referencia_pago, creado_en
  )
  values (
    v_folio, p_nombre_cliente, p_telefono, p_huella, p_total_centavos, v_estado, v_modo, v_metodo,
    v_referencia, now()
  )
  returning id_pedido into v_id_pedido;

  -- El historial guarda los dos pasos con la misma hora (D42).
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

  return query select v_folio, p_total_centavos, v_estado, false, v_modo, v_metodo, v_referencia,
    case when v_referencia is null then null else v_clabe end;
end;
$$;

revoke execute on function public.crear_pedido(text, text, text, integer, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.crear_pedido(text, text, text, integer, jsonb, integer, text)
  to service_role;

-- 4. El cliente pide los datos de pago por WhatsApp. Resultados:
--   'pedido'        se anotó la hora;
--   'ya_pedido'     ya se había pedido (no cambia la hora);
--   'no_aplica'     el pedido no es por transferencia o ya no espera el pago;
--   'no_encontrado' no hay un pedido con ese folio y ese teléfono (no dice cuál de los dos falló).
create function public.pedir_datos_whatsapp(p_folio integer, p_telefono text)
returns table (resultado text, pedido_en timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_metodo text;
  v_estado text;
  v_pedido_en timestamptz;
begin
  select p.id_pedido, p.metodo_pago, p.estado, p.datos_whatsapp_pedidos_en
  into v_id_pedido, v_metodo, v_estado, v_pedido_en
  from public.pedidos p
  where p.folio = p_folio and p.telefono = p_telefono
  for update;

  if not found then
    return query select 'no_encontrado'::text, null::timestamptz;
  elsif v_metodo is distinct from 'transferencia' or v_estado <> 'esperando_pago' then
    return query select 'no_aplica'::text, null::timestamptz;
  elsif v_pedido_en is not null then
    return query select 'ya_pedido'::text, v_pedido_en;
  else
    update public.pedidos p set datos_whatsapp_pedidos_en = now() where p.id_pedido = v_id_pedido;
    return query select 'pedido'::text, now();
  end if;
end;
$$;

revoke execute on function public.pedir_datos_whatsapp(integer, text) from public, anon, authenticated;
grant execute on function public.pedir_datos_whatsapp(integer, text) to service_role;
