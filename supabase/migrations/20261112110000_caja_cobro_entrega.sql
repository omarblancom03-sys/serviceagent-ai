-- US-21: caja cobra en efectivo o con tarjeta y entrega el pedido (docs/negocio.md → Pagos, D66).
--
-- 1. cobrar_pedido_caja: registra UN pago por lo que falta del total. El monto lo calcula la base
--    (total menos lo ya pagado), nunca llega de la API ni de la pantalla.
-- 2. entregar_pedido_caja: listo → entregado, solo si el pedido ya está pagado; guarda en el
--    historial la hora (now(), D42) y el empleado.
--
-- Las dos bloquean la fila del pedido (for update): dos cajas que tocan el mismo pedido a la vez se
-- ponen en fila y la segunda ya ve lo que hizo la primera (D14). Así no hay dos cobros ni dos
-- entregas. El mismo candado ordena la entrega con el Regresar de cocina (regresar_pedido_cocina).
--
-- Los triggers pagos_senal_cambio y pedidos_senal_cambio ya avisan a las pantallas (D47).

-- Las funciones corren con los permisos de service_role (no son security definer): necesita
-- insertar pagos. La hora y el id los pone la base. El update (estado) de pedidos y el insert del
-- historial ya los tenía (20261022100000_cocina_cambio_estado.sql y 20261011100000_crear_pedidos.sql).
grant insert (id_pedido, metodo, monto_centavos, id_empleado) on table public.pagos to service_role;

-- Cobra lo que falta del pedido. Resultados:
--   'cobrado'            con el monto y la hora del pago;
--   'ya_pagado'          la suma de sus pagos ya cubre el total (no se cobra dos veces);
--   'estado_no_cobrable' el pedido no está en la cola, preparándose ni listo: uno cancelado,
--                        expirado o entregado no se cobra, y uno que espera una transferencia
--                        todavía no (cuándo pasa a cocina al pagarse lo define US-25).
-- Devuelve cero filas si el folio no existe (la API responde 404).
create function public.cobrar_pedido_caja(
  p_folio integer,
  p_metodo text,
  p_id_empleado uuid
)
returns table (
  resultado text,
  estado_actual text,
  cobrado_centavos integer,
  cobrado_en timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_estado text;
  v_total integer;
  v_pagado integer;
  v_pendiente integer;
begin
  -- Segunda barrera: la API solo manda estos dos métodos. La transferencia la registra el webhook
  -- del banco (US-25), no caja.
  if p_metodo is null or p_metodo not in ('efectivo', 'tarjeta') then
    raise exception 'Caja solo cobra en efectivo o con tarjeta (llegó %).', p_metodo;
  end if;
  if p_id_empleado is null then
    raise exception 'Falta el empleado que cobra.';
  end if;

  select p.id_pedido, p.estado, p.total_centavos
  into v_id_pedido, v_estado, v_total
  from public.pedidos p
  where p.folio = p_folio
  for update;
  if not found then
    return;
  end if;

  select coalesce(sum(g.monto_centavos), 0)::integer into v_pagado
  from public.pagos g
  where g.id_pedido = v_id_pedido;

  if v_pagado >= v_total then
    return query select 'ya_pagado'::text, v_estado, null::integer, null::timestamptz;
    return;
  end if;
  if v_estado not in ('en_cola', 'preparando', 'listo') then
    return query select 'estado_no_cobrable'::text, v_estado, null::integer, null::timestamptz;
    return;
  end if;

  v_pendiente := v_total - v_pagado;
  insert into public.pagos (id_pedido, metodo, monto_centavos, id_empleado)
  values (v_id_pedido, p_metodo, v_pendiente, p_id_empleado);

  return query select 'cobrado'::text, v_estado, v_pendiente, now();
end;
$$;

revoke execute on function public.cobrar_pedido_caja(integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cobrar_pedido_caja(integer, text, uuid) to service_role;

-- Entrega el pedido: listo → entregado. Resultados:
--   'entregado'       con la hora de la entrega;
--   'estado_distinto' el pedido ya no está listo (otra caja lo entregó, cocina lo regresó a
--                     preparación o se canceló);
--   'falta_pago'      está listo pero la suma de sus pagos no cubre el total: primero se cobra.
-- Devuelve cero filas si el folio no existe (la API responde 404).
create function public.entregar_pedido_caja(
  p_folio integer,
  p_id_empleado uuid
)
returns table (resultado text, estado_actual text, entregado_en timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_estado text;
  v_total integer;
  v_pagado integer;
begin
  if p_id_empleado is null then
    raise exception 'Falta el empleado que entrega.';
  end if;

  select p.id_pedido, p.estado, p.total_centavos
  into v_id_pedido, v_estado, v_total
  from public.pedidos p
  where p.folio = p_folio
  for update;
  if not found then
    return;
  end if;

  if v_estado <> 'listo' then
    return query select 'estado_distinto'::text, v_estado, null::timestamptz;
    return;
  end if;

  select coalesce(sum(g.monto_centavos), 0)::integer into v_pagado
  from public.pagos g
  where g.id_pedido = v_id_pedido;

  if v_pagado < v_total then
    return query select 'falta_pago'::text, v_estado, null::timestamptz;
    return;
  end if;

  update public.pedidos p set estado = 'entregado' where p.id_pedido = v_id_pedido;
  insert into public.historial_estado_pedido (id_pedido, estado, id_empleado, creado_en)
  values (v_id_pedido, 'entregado', p_id_empleado, now());

  return query select 'entregado'::text, 'entregado'::text, now();
end;
$$;

revoke execute on function public.entregar_pedido_caja(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.entregar_pedido_caja(integer, uuid) to service_role;
