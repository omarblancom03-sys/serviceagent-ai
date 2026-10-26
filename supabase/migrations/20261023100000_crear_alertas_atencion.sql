-- US-18: alertas "Cliente requiere atención" (custom function transferir_a_empleado, D59).
--
-- El agente pide que un empleado atienda al cliente y la API guarda una alerta para caja y admin:
-- una sola por conversación de Retell. Nunca se guarda la conversación (ni la transcripción ni los
-- mensajes): solo teléfono, nombre, folio y el motivo que resume el agente.

create table public.alertas_atencion (
  id_alerta integer generated always as identity primary key,
  -- "Una alerta por conversación" la cumple la base con este unique (D14). Mismo largo que
  -- conversaciones_chat. Sin llave foránea a esa tabla: el chat de prueba del dashboard de Retell
  -- no pasa por nuestra API. Nunca sale de la API (D36).
  chat_id_retell text not null unique check (char_length(chat_id_retell) between 1 and 128),
  -- Ya normalizado por la API, con la misma regla que pedidos (D32).
  telefono text not null check (telefono ~ '^[2-9][0-9]{9}$'),
  nombre_cliente text check (length(trim(nombre_cliente)) between 2 and 60),
  -- Solo un folio que existe y es de ese teléfono; si no, crear_alerta_atencion lo deja vacío.
  -- Sin llave foránea a pedidos: la regla es más que "existe" y la aplica la función.
  folio integer,
  motivo text not null check (char_length(motivo) between 1 and 200 and btrim(motivo) <> ''),
  -- Hora puesta por Postgres (D42).
  creado_en timestamptz not null default now(),
  -- Pendiente mientras las dos estén vacías. Quién la atendió sale de la sesión, nunca del cuerpo.
  atendida_en timestamptz,
  atendida_por uuid references public.empleados (id),
  constraint alertas_atencion_atendida_completa check ((atendida_en is null) = (atendida_por is null))
);

-- Caja lee solo las pendientes, de la más antigua a la más nueva.
create index alertas_atencion_pendientes on public.alertas_atencion (creado_en)
where atendida_en is null;

comment on table public.alertas_atencion is
  'Alertas "Cliente requiere atención" del agente (una por conversación). Solo la API la lee y escribe.';

revoke all on table public.alertas_atencion from anon, authenticated, service_role;
grant select on table public.alertas_atencion to service_role;
-- La API solo crea con crear_alerta_atencion y atiende con marcar_alerta_atendida. Sin delete.
grant insert (chat_id_retell, telefono, nombre_cliente, folio, motivo)
  on table public.alertas_atencion to service_role;
grant update (atendida_en, atendida_por) on table public.alertas_atencion to service_role;
alter table public.alertas_atencion enable row level security;

-- 1. Crea la alerta si esa conversación no tiene una. Atómica sin candado: con el unique, dos
--    llamadas al mismo tiempo nunca crean dos filas (D14). El folio se guarda solo si existe y es
--    de ese teléfono; si no, la alerta se guarda igual sin folio, así nunca se pierde y caja nunca
--    ve el pedido de otra persona. Devuelve si la creó y si el folio no se encontró.
create function public.crear_alerta_atencion(
  p_chat_id text,
  p_telefono text,
  p_nombre_cliente text,
  p_folio integer,
  p_motivo text
)
returns table (creada boolean, folio_no_encontrado boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_folio integer;
  v_id_alerta integer;
begin
  if p_folio is not null then
    select p.folio into v_folio
    from public.pedidos p
    where p.folio = p_folio and p.telefono = p_telefono;
  end if;

  insert into public.alertas_atencion (chat_id_retell, telefono, nombre_cliente, folio, motivo)
  values (p_chat_id, p_telefono, p_nombre_cliente, v_folio, p_motivo)
  on conflict (chat_id_retell) do nothing
  returning id_alerta into v_id_alerta;

  if v_id_alerta is null then
    -- Ya existía: no se cambió nada, así que el folio de esta llamada no importa.
    return query select false, false;
  else
    return query select true, p_folio is not null and v_folio is null;
  end if;
end;
$$;

revoke execute on function public.crear_alerta_atencion(text, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.crear_alerta_atencion(text, text, text, integer, text)
  to service_role;

-- 2. Marca la alerta como atendida por el empleado de la sesión (la ruta llega en US-18 P1-B).
--    Solo si sigue pendiente, en una sola sentencia (D14): si dos cajeros la marcan casi al mismo
--    tiempo, el segundo recibe 'ya_atendida'. Devuelve 'atendida', 'ya_atendida' o
--    'no_encontrada', y la hora en que quedó atendida (vacía si no existe).
create function public.marcar_alerta_atendida(p_id_alerta integer, p_id_empleado uuid)
returns table (resultado text, atendida_en timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_atendida_en timestamptz;
begin
  update public.alertas_atencion a
  set atendida_en = now(), atendida_por = p_id_empleado
  where a.id_alerta = p_id_alerta and a.atendida_en is null
  returning a.atendida_en into v_atendida_en;
  if found then
    return query select 'atendida'::text, v_atendida_en;
    return;
  end if;

  select a.atendida_en into v_atendida_en
  from public.alertas_atencion a
  where a.id_alerta = p_id_alerta;
  if found then
    return query select 'ya_atendida'::text, v_atendida_en;
  else
    return query select 'no_encontrada'::text, null::timestamptz;
  end if;
end;
$$;

revoke execute on function public.marcar_alerta_atendida(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.marcar_alerta_atendida(integer, uuid) to service_role;

-- 3. Señal de Realtime para caja y admin (D47, D59): mismo canal público 'pedidos', evento
--    'alerta', payload vacío; oírla solo dice "algo cambió" y la pantalla pide la lista a la API
--    con su JWT. De mejor esfuerzo: si Realtime falla, la alerta se guarda igual.
create function public.senal_alerta_atencion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform realtime.send('{}'::jsonb, 'alerta', 'pedidos', false);
  exception when others then
    raise warning 'No se pudo mandar la señal de Realtime: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.senal_alerta_atencion() from public, anon, authenticated;

-- Una por sentencia. Una alerta repetida (on conflict do nothing) o marcar una que ya estaba
-- atendida también avisan, aunque no cambie ninguna fila: a lo más, una recarga de más (D47).
create trigger alertas_atencion_senal
after insert or update of atendida_en on public.alertas_atencion
for each statement
execute function public.senal_alerta_atencion();
