-- US-52-P1: "Terminados recientes" en cocina (docs/negocio.md → Estados del pedido, D63).
--
-- 1. leer_terminados_cocina: pedidos en 'listo' cuyo último Terminado fue hace a lo más
--    p_minutos, del más reciente al más viejo. El corte usa now() de Postgres (D42): la API no
--    manda la hora.
-- 2. regresar_pedido_cocina: botón Regresar (listo → preparando) en un solo update con la fila
--    bloqueada, solo si sigue en 'listo' y dentro del plazo. Inserta una fila 'preparando' con el
--    empleado (no borra la de 'listo', a diferencia de deshacer_estado_cocina): el Terminado fue
--    real y queda quién regresó el pedido. La hora de entrada a la cola no cambia.
-- 3. Índice parcial de los pedidos en 'listo'.
--
-- No hay columnas nuevas: la hora de Terminado es la última fila 'listo' del historial, igual que
-- enColaDesde sale de la última fila 'en_cola'. Tampoco hay trigger nuevo: Regresar hace update de
-- pedidos.estado y pedidos_senal_cambio (20261015100000_cocina_tiempo_real.sql) avisa (D47).
-- Los permisos de tabla que usan ya existen: select e insert (20261011100000_crear_pedidos.sql) y
-- update (estado) (20261022100000_cocina_cambio_estado.sql).

-- Folio y hora del último Terminado de cada pedido que sigue en 'listo' desde hace a lo más
-- p_minutos. Como máximo p_limite, del más reciente al más viejo; con la misma hora, el folio mayor
-- primero. La API lee después los renglones de esos folios.
create function public.leer_terminados_cocina(p_minutos integer, p_limite integer)
returns table (folio integer, terminado_en timestamptz)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_minutos is null or p_minutos not between 1 and 60 then
    raise exception 'Los minutos de terminados recientes deben ser de 1 a 60 (llegó %).',
      p_minutos;
  end if;
  if p_limite is null or p_limite not between 1 and 100 then
    raise exception 'El límite de terminados recientes debe ser de 1 a 100 (llegó %).', p_limite;
  end if;

  return query
  select p.folio, t.terminado_en
  from public.pedidos p
  cross join lateral (
    select max(h.creado_en) as terminado_en
    from public.historial_estado_pedido h
    where h.id_pedido = p.id_pedido and h.estado = 'listo'
  ) t
  where p.estado = 'listo'
    and t.terminado_en > now() - make_interval(mins => p_minutos)
  order by t.terminado_en desc, p.folio desc
  limit p_limite;
end;
$$;

revoke execute on function public.leer_terminados_cocina(integer, integer)
  from public, anon, authenticated;
grant execute on function public.leer_terminados_cocina(integer, integer) to service_role;

-- Regresa a 'preparando' un pedido terminado. La fila del pedido se bloquea (for update): si caja
-- lo entrega u otra tablet lo regresa al mismo tiempo, una espera a la otra y solo una gana (D14).
-- Devuelve el estado actual, el motivo y la hora del cambio:
--   motivo = null y cambiado_en con la hora: se regresó.
--   'estado_distinto': ya no está en 'listo' (entregado, cancelado, otra tablet lo regresó…); la
--     API elige el mensaje según estado_actual.
--   'plazo_vencido': el último Terminado tiene más de p_minutos_plazo minutos.
-- Devuelve cero filas si el folio no existe (la API responde 404).
create function public.regresar_pedido_cocina(
  p_folio integer,
  p_id_empleado uuid,
  p_minutos_plazo integer
)
returns table (estado_actual text, motivo text, cambiado_en timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_estado text;
  v_terminado_en timestamptz;
begin
  -- Quién regresó el pedido sale de la sesión en la API; siempre es un empleado.
  if p_id_empleado is null then
    raise exception 'Falta el empleado que regresa el pedido.';
  end if;
  if p_minutos_plazo is null or p_minutos_plazo not between 1 and 60 then
    raise exception 'El plazo para regresar debe ser de 1 a 60 minutos (llegó %).',
      p_minutos_plazo;
  end if;

  select p.id_pedido, p.estado into v_id_pedido, v_estado
  from public.pedidos p
  where p.folio = p_folio
  for update;
  if not found then
    return;
  end if;

  if v_estado <> 'listo' then
    return query select v_estado, 'estado_distinto'::text, null::timestamptz;
    return;
  end if;

  -- Desde el último Terminado (si lo regresaron y lo volvieron a terminar, cuenta el nuevo). Un
  -- 'listo' sin su fila en el historial no debería existir; si existe, no se regresa.
  select max(h.creado_en) into v_terminado_en
  from public.historial_estado_pedido h
  where h.id_pedido = v_id_pedido and h.estado = 'listo';
  if v_terminado_en is null
    or now() - v_terminado_en > make_interval(mins => p_minutos_plazo) then
    return query select v_estado, 'plazo_vencido'::text, null::timestamptz;
    return;
  end if;

  update public.pedidos p set estado = 'preparando' where p.id_pedido = v_id_pedido;
  insert into public.historial_estado_pedido (id_pedido, estado, id_empleado, creado_en)
  values (v_id_pedido, 'preparando', p_id_empleado, now());
  return query select 'preparando'::text, null::text, now();
end;
$$;

revoke execute on function public.regresar_pedido_cocina(integer, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.regresar_pedido_cocina(integer, uuid, integer) to service_role;

-- Los terminados recientes se buscan entre los pedidos en 'listo'; el índice parcial los encuentra
-- sin recorrer los entregados de días anteriores. El historial ya tiene su índice por id_pedido.
create index pedidos_estado_listo on public.pedidos (estado)
where estado = 'listo';
