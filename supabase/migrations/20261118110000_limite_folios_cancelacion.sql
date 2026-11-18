-- US-14-T2: límite de folios no encontrados por conversación al cancelar (D79; precisa D71 y D74).
--
-- Para cancelar bastan el folio y el teléfono (D74), y los folios son consecutivos: quien conoce
-- un teléfono podría probar folios recientes hasta dar con uno. Ahora cancelar_pedido_cliente
-- cuenta los 'no_encontrado' de cada conversación de Retell (chat.chat_id) y, al llegar al límite,
-- deja de buscar: responde 'demasiados_intentos' aunque el folio sea correcto, para no revelar si
-- existe. Un folio de otro teléfono también cuenta: responde igual que uno inexistente (D71) y si
-- no contara, el contador delataría qué folios existen.
--
-- 1. intentos_cancelacion_chat: un contador por conversación. Solo el id del chat y números: ni
--    folios ni teléfonos.
-- 2. cancelar_pedido_cliente cambia de firma: recibe el id del chat y el límite (vive en la API,
--    MAX_FOLIOS_NO_ENCONTRADOS, igual que los topes de conversaciones_chat).

create table public.intentos_cancelacion_chat (
  -- El chat_id de Retell, mismo largo que en conversaciones_chat y alertas_atencion.
  chat_id_retell text primary key check (char_length(chat_id_retell) between 1 and 128),
  folios_no_encontrados integer not null default 0 check (folios_no_encontrados >= 0),
  creado_en timestamptz not null default now(),
  -- Último no_encontrado contado (null mientras no hay ninguno).
  ultimo_no_encontrado_en timestamptz
);

comment on table public.intentos_cancelacion_chat is
  'Folios no encontrados por conversación al cancelar por el agente (D79). Sin folios ni teléfonos. Solo la API la usa, a través de cancelar_pedido_cliente.';

-- Permisos explícitos (supabase/CLAUDE.md, D15). La función es security invoker: corre con los
-- permisos de service_role, que necesita leer y bloquear la fila (select ... for update pide
-- update), insertarla y actualizar el contador. Sin delete. anon y authenticated, nada.
revoke all on table public.intentos_cancelacion_chat from anon, authenticated, service_role;
grant select on table public.intentos_cancelacion_chat to service_role;
grant insert (chat_id_retell) on table public.intentos_cancelacion_chat to service_role;
grant update (folios_no_encontrados, ultimo_no_encontrado_en)
  on table public.intentos_cancelacion_chat to service_role;

-- RLS activo y sin políticas: segunda barrera si algún día alguien concede permisos a anon.
alter table public.intentos_cancelacion_chat enable row level security;

-- La firma vieja (folio, teléfono, motivo) desaparece: una API sin actualizar falla con un error
-- de función inexistente en vez de cancelar sin contar.
drop function public.cancelar_pedido_cliente(integer, text, text);

-- Cancela el pedido p_folio a nombre del cliente, en la conversación p_chat_id. Devuelve una fila:
--   'cancelado':     se canceló ahora; cancelado_en trae la hora (now(), D42).
--   'ya_cancelado':  ya estaba cancelado; no cambia nada (el agente pudo repetir la llamada).
--   'no_encontrado': el folio no existe o no es de ese teléfono (misma respuesta, D71). Suma 1 al
--                    contador de la conversación.
--   'demasiados_intentos': la conversación ya juntó p_max_no_encontrados; no se buscó el pedido.
--   'con_pago':      tiene al menos un pago: no se cancela aquí (devolver dinero lo ve un empleado).
--   'no_cancelable': ya está en preparación, listo, entregado o expirado.
-- estado_actual es el estado en que quedó (null si no se encontró o no se buscó).
--
-- Dos llamadas a la vez sobre la misma conversación (D14): la fila del contador se crea si falta
-- (insert ... on conflict do nothing) y se bloquea (for update) ANTES de buscar el pedido. La
-- segunda espera a que la primera termine y lee el contador ya sumado: ninguna se salta el límite.
-- Encontrar un pedido no reinicia el contador: si lo hiciera, alguien con un pedido propio podría
-- ponerlo en cero entre intento e intento.
create function public.cancelar_pedido_cliente(
  p_folio integer,
  p_telefono text,
  p_motivo text,
  p_chat_id text,
  p_max_no_encontrados integer
)
returns table (resultado text, estado_actual text, cancelado_en timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_no_encontrados integer;
  v_id_pedido integer;
  v_estado text;
begin
  if p_max_no_encontrados is null or p_max_no_encontrados <= 0 then
    raise exception 'p_max_no_encontrados debe ser mayor que 0'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Un chat_id nulo o fuera de 1..128 lo rechaza el check de la tabla (la API ya lo filtra).
  insert into public.intentos_cancelacion_chat (chat_id_retell)
  values (p_chat_id)
  on conflict (chat_id_retell) do nothing;

  select i.folios_no_encontrados into v_no_encontrados
  from public.intentos_cancelacion_chat i
  where i.chat_id_retell = p_chat_id
  for update;

  if v_no_encontrados >= p_max_no_encontrados then
    return query select 'demasiados_intentos'::text, null::text, null::timestamptz;
    return;
  end if;

  select p.id_pedido, p.estado into v_id_pedido, v_estado
  from public.pedidos p
  where p.folio = p_folio and p.telefono = p_telefono
  for update;

  if not found then
    update public.intentos_cancelacion_chat i
    set folios_no_encontrados = i.folios_no_encontrados + 1, ultimo_no_encontrado_en = now()
    where i.chat_id_retell = p_chat_id;
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

revoke execute on function public.cancelar_pedido_cliente(integer, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.cancelar_pedido_cliente(integer, text, text, text, integer)
  to service_role;
