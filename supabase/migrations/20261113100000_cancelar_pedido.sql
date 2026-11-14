-- US-14-P1: el cliente cancela su pedido por el agente (docs/negocio.md → Estados del pedido, D71).
--
-- 1. El historial guarda el motivo de la cancelación, en la misma fila del cambio a 'cancelado'.
-- 2. cancelar_pedido_cliente: cancela solo si el folio es de ese teléfono, el pedido todavía no
--    entra a preparación y no tiene pagos. Todo en una transacción y con la fila bloqueada.
--
-- El trigger pedidos_senal_cambio (20261015100000_cocina_tiempo_real.sql) avisa a las pantallas
-- porque la función hace update de pedidos.estado (D47): el ticket sale de cocina sin recargar.

alter table public.historial_estado_pedido
  add column motivo text,
  add constraint historial_estado_pedido_motivo check (
    motivo is null
    or (estado = 'cancelado' and char_length(motivo) between 1 and 200 and btrim(motivo) <> '')
  );

comment on column public.historial_estado_pedido.motivo is
  'Por qué se canceló, como lo resumió el agente. Solo en las filas con estado cancelado.';

-- Cancela el pedido p_folio a nombre del cliente. Devuelve una fila con el resultado:
--   'cancelado':     se canceló ahora; cancelado_en trae la hora (now(), D42).
--   'ya_cancelado':  ya estaba cancelado; no cambia nada (el agente pudo repetir la llamada).
--   'no_encontrado': el folio no existe o no es de ese teléfono. Es la misma respuesta en los dos
--                    casos, para no decirle a nadie si existe el pedido de otra persona.
--   'con_pago':      tiene al menos un pago: no se cancela aquí (devolver dinero lo ve un empleado).
--   'no_cancelable': ya está en preparación, listo, entregado o expirado.
-- estado_actual es el estado en que quedó (null si no se encontró).
--
-- La fila del pedido se bloquea (for update): si cocina pulsa Empezar o caja cobra al mismo
-- tiempo, uno espera al otro y el segundo ya ve el cambio del primero (D14).
create function public.cancelar_pedido_cliente(
  p_folio integer,
  p_telefono text,
  p_motivo text
)
returns table (resultado text, estado_actual text, cancelado_en timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_id_pedido integer;
  v_estado text;
begin
  select p.id_pedido, p.estado into v_id_pedido, v_estado
  from public.pedidos p
  where p.folio = p_folio and p.telefono = p_telefono
  for update;

  if not found then
    return query select 'no_encontrado'::text, null::text, null::timestamptz;
    return;
  end if;

  if v_estado = 'cancelado' then
    return query select 'ya_cancelado'::text, v_estado, null::timestamptz;
    return;
  end if;

  if v_estado not in ('confirmado', 'esperando_pago', 'en_cola') then
    return query select 'no_cancelable'::text, v_estado, null::timestamptz;
    return;
  end if;

  if exists (select 1 from public.pagos g where g.id_pedido = v_id_pedido) then
    return query select 'con_pago'::text, v_estado, null::timestamptz;
    return;
  end if;

  update public.pedidos p set estado = 'cancelado' where p.id_pedido = v_id_pedido;

  -- id_empleado queda en null: lo canceló el cliente, no un empleado.
  insert into public.historial_estado_pedido (id_pedido, estado, motivo, creado_en)
  values (v_id_pedido, 'cancelado', p_motivo, now());

  return query select 'cancelado'::text, 'cancelado'::text, now();
end;
$$;

revoke execute on function public.cancelar_pedido_cliente(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.cancelar_pedido_cliente(integer, text, text) to service_role;
