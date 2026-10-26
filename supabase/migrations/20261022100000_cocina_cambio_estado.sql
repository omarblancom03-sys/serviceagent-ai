-- US-11-P1: cocina cambia el estado de un pedido (docs/negocio.md → Estados del pedido, D56).
--
-- 1. El historial guarda quién hizo cada cambio. Las filas de crear_pedido quedan en null: las
--    hace el sistema, no un empleado.
-- 2. cambiar_estado_cocina: Empezar (en_cola → preparando) y Terminado (preparando → listo) en un
--    solo update condicionado al estado esperado, más su fila del historial con now() (D42).
-- 3. deshacer_estado_cocina: regresa el último cambio de cocina dentro del plazo, borrando su fila
--    del historial (no inserta una fila inversa, así la hora de entrada a la cola no cambia).
--
-- El trigger pedidos_senal_cambio (20261015100000_cocina_tiempo_real.sql) avisa a las pantallas
-- en ambos casos porque los dos hacen update de pedidos.estado (D47).

alter table public.historial_estado_pedido
  add column id_empleado uuid references public.empleados (id);

comment on column public.historial_estado_pedido.id_empleado is
  'Empleado que hizo el cambio (sale de su sesión en la API). null si lo hizo el sistema.';

-- Cambia el estado solo si el pedido sigue en p_estado_desde. Dos tablets que pulsan a la vez:
-- la segunda espera a la primera, vuelve a revisar el where y ya no cambia nada (D14).
-- Devuelve el estado actual y la hora del cambio; cambiado_en es null si no cambió (la API responde
-- 409). Devuelve cero filas si el folio no existe (404).
create function public.cambiar_estado_cocina(
  p_folio integer,
  p_estado_desde text,
  p_estado_hacia text,
  p_id_empleado uuid
)
returns table (estado_actual text, cambiado_en timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_estado text;
begin
  -- Segunda barrera: la API solo pide estas dos transiciones.
  if (p_estado_desde, p_estado_hacia) not in (('en_cola', 'preparando'), ('preparando', 'listo')) then
    raise exception 'Cocina no puede pasar un pedido de % a %.', p_estado_desde, p_estado_hacia;
  end if;

  update public.pedidos p set estado = p_estado_hacia
  where p.folio = p_folio and p.estado = p_estado_desde
  returning p.id_pedido into v_id_pedido;

  if found then
    insert into public.historial_estado_pedido (id_pedido, estado, id_empleado, creado_en)
    values (v_id_pedido, p_estado_hacia, p_id_empleado, now());
    return query select p_estado_hacia, now();
    return;
  end if;

  select p.estado into v_estado from public.pedidos p where p.folio = p_folio;
  if found then
    return query select v_estado, null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.cambiar_estado_cocina(integer, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cambiar_estado_cocina(integer, text, text, uuid) to service_role;

-- Deshace el último cambio de cocina: preparando → en_cola (Empezar) o listo → preparando
-- (Terminado). Solo si el pedido está en p_estado, la última fila de su historial es p_estado y
-- tiene a lo más p_segundos_plazo segundos. Borra esa fila y regresa al estado anterior.
-- La fila del pedido se bloquea (for update) para que un Empezar o Terminado al mismo tiempo
-- espere y no deje el historial desordenado.
-- Devuelve el estado actual y motivo = null si se deshizo, o 'estado_distinto' / 'plazo_vencido'
-- (la API responde 409). Devuelve cero filas si el folio no existe (404).
create function public.deshacer_estado_cocina(
  p_folio integer,
  p_estado text,
  p_segundos_plazo integer
)
returns table (estado_actual text, motivo text)
language plpgsql
set search_path = ''
as $$
declare
  v_anterior text;
  v_id_pedido integer;
  v_estado text;
  v_id_historial integer;
  v_estado_historial text;
  v_creado_en timestamptz;
begin
  v_anterior := case p_estado when 'preparando' then 'en_cola' when 'listo' then 'preparando' end;
  if v_anterior is null then
    raise exception 'Cocina no puede deshacer el estado %.', p_estado;
  end if;
  if p_segundos_plazo is null or p_segundos_plazo not between 1 and 60 then
    raise exception 'El plazo para deshacer debe ser de 1 a 60 segundos (llegó %).', p_segundos_plazo;
  end if;

  select p.id_pedido, p.estado into v_id_pedido, v_estado
  from public.pedidos p
  where p.folio = p_folio
  for update;
  if not found then
    return;
  end if;

  -- crear_pedido guarda 'confirmado' y 'en_cola' con la misma hora: el id desempata.
  select h.id_historial, h.estado, h.creado_en
  into v_id_historial, v_estado_historial, v_creado_en
  from public.historial_estado_pedido h
  where h.id_pedido = v_id_pedido
  order by h.creado_en desc, h.id_historial desc
  limit 1;

  if v_estado <> p_estado or v_estado_historial is distinct from p_estado then
    return query select v_estado, 'estado_distinto'::text;
    return;
  end if;
  if now() - v_creado_en > make_interval(secs => p_segundos_plazo) then
    return query select v_estado, 'plazo_vencido'::text;
    return;
  end if;

  delete from public.historial_estado_pedido h where h.id_historial = v_id_historial;
  update public.pedidos p set estado = v_anterior where p.id_pedido = v_id_pedido;
  return query select v_anterior, null::text;
end;
$$;

revoke execute on function public.deshacer_estado_cocina(integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.deshacer_estado_cocina(integer, text, integer) to service_role;

-- Las funciones corren como service_role (no son security definer): necesita cambiar el estado
-- (también para el for update) y borrar la fila que se deshace. El insert al historial ya lo tenía
-- desde 20261011100000_crear_pedidos.sql y cubre la columna nueva.
grant update (estado) on table public.pedidos to service_role;
grant delete on table public.historial_estado_pedido to service_role;
