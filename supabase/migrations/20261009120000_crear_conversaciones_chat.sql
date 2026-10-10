-- US-09-P1: conversaciones del chat web que abrió nuestra API (proxy a Retell, D21).
-- Cuenta los mensajes del cliente por conversación y el tope diario de conversaciones nuevas.
-- Solo guarda contadores y fechas: el contenido de los mensajes y cualquier dato personal se
-- quedan en Retell. Todo cambio pasa por las funciones de abajo, nunca leyendo, calculando en la
-- API y guardando (D14). Los límites (mensajes por conversación, tope diario) viven en la API y
-- llegan como parámetros.

create table public.conversaciones_chat (
  -- Es el `conversacionId` público del contrato (packages/shared/src/chat.ts). El `chat_id` de
  -- Retell nunca sale del servidor.
  id uuid primary key default gen_random_uuid(),
  -- Null mientras Retell no responde al abrir. Sin formato fijo: el de Retell no está verificado.
  chat_id_retell text unique check (length(chat_id_retell) between 1 and 128),
  mensajes_usados integer not null default 0 check (mensajes_usados >= 0),
  -- Null = activa.
  terminada_en timestamptz,
  creado_en timestamptz not null default now(),
  ultimo_mensaje_en timestamptz
);

comment on table public.conversaciones_chat is
  'Conversaciones del chat web abiertas por la API: conteo de mensajes del cliente y tope diario. Sin contenido de mensajes. Solo la API la usa, a través de funciones.';

-- El tope diario cuenta las conversaciones creadas en un rango de fechas.
create index conversaciones_chat_creado_en_idx on public.conversaciones_chat (creado_en);

-- Permisos explícitos (supabase/CLAUDE.md, D15). Las funciones son security invoker: corren con
-- los permisos de service_role, que necesita leer, insertar la fecha de creación y actualizar
-- solo estas columnas. Sin delete. anon y authenticated no tienen ningún permiso.
revoke all on table public.conversaciones_chat from anon, authenticated, service_role;
grant select on table public.conversaciones_chat to service_role;
grant insert (creado_en) on table public.conversaciones_chat to service_role;
grant update (chat_id_retell, mensajes_usados, terminada_en, ultimo_mensaje_en)
  on table public.conversaciones_chat to service_role;

-- RLS activo y sin políticas: segunda barrera si algún día alguien concede permisos a anon.
alter table public.conversaciones_chat enable row level security;

-- Abrir conversación
-- Registra una conversación nueva si en el día calendario de p_ahora todavía no se llega a
-- p_tope_diario. El día es el de la zona del restaurante (America/Chihuahua): en UTC el tope se
-- reiniciaría a media tarde. Devuelve 'abierta' con el id, o 'tope_alcanzado' sin id.
--
-- Contar y luego insertar no es atómico: dos peticiones podrían ver el mismo conteo y pasarse
-- del tope. Por eso la función toma primero un candado de transacción (pg_advisory_xact_lock),
-- que pone en fila solo las aperturas y se suelta solo al terminar la llamada. La clave es una
-- constante arbitraria reservada para este tope; otro candado del proyecto debe usar otra.
--
-- La API llama a esta función ANTES de crear el chat en Retell. Si Retell falla, la API termina
-- la conversación y el lugar queda gastado a propósito (si Retell tardó, pudo haber creado el
-- chat y cobrado). Consecuencia: una caída de Retell consume el tope del día y no se recupera
-- hasta el siguiente día calendario.
create function public.abrir_conversacion_chat(
  p_tope_diario integer,
  p_ahora timestamptz default now()
)
returns table (resultado text, conversacion_id uuid)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_dia date;
  v_inicio timestamptz;
  v_fin timestamptz;
  v_abiertas integer;
  v_id uuid;
begin
  if p_tope_diario is null or p_tope_diario < 0 or p_ahora is null then
    raise exception 'abrir_conversacion_chat: parámetros inválidos' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(9010001);

  v_dia := (p_ahora at time zone 'America/Chihuahua')::date;
  v_inicio := v_dia::timestamp at time zone 'America/Chihuahua';
  v_fin := (v_dia + 1)::timestamp at time zone 'America/Chihuahua';

  select count(*) into v_abiertas
  from public.conversaciones_chat c
  where c.creado_en >= v_inicio and c.creado_en < v_fin;

  if v_abiertas >= p_tope_diario then
    return query select 'tope_alcanzado'::text, null::uuid;
    return;
  end if;

  insert into public.conversaciones_chat as c (creado_en)
  values (p_ahora)
  returning c.id into v_id;

  return query select 'abierta'::text, v_id;
end;
$$;

-- Asociar el chat de Retell
-- Guarda el chat_id que devolvió Retell. Solo si la conversación sigue activa y aún no tiene
-- uno. Devuelve true si lo guardó.
create function public.asociar_chat_retell(p_conversacion_id uuid, p_chat_id text)
returns boolean
language sql
set search_path = ''
as $$
  with actualizada as (
    update public.conversaciones_chat c set chat_id_retell = p_chat_id
    where c.id = p_conversacion_id
      and c.terminada_en is null
      and c.chat_id_retell is null
      and p_chat_id is not null
    returning c.id
  )
  select exists (select 1 from actualizada);
$$;

-- Registrar un mensaje del cliente
-- La API cuenta el mensaje ANTES de mandarlo a Retell; si Retell falla, lo regresa con
-- devolver_mensaje_chat. Así una ráfaga de peticiones nunca pasa del límite: el UPDATE bloquea
-- la fila y Postgres vuelve a evaluar el where sobre la versión ya actualizada, de modo que con
-- 29 usados y límite 30 solo una petición pasa.
--
-- Resultados: 'registrado' (con el conteo nuevo y el chat_id para llamar a Retell),
-- 'no_encontrada', 'terminada' o 'limite_alcanzado'. Una conversación sin chat_id es
-- 'no_encontrada': su id nunca se entregó al cliente.
--
-- Sentencias separadas a propósito: si el UPDATE no tocó la fila, la consulta siguiente ve lo
-- ya confirmado por otras peticiones y clasifica con el estado actual. Si no encuentra una causa
-- clara, responde 'limite_alcanzado', el error más conservador; nunca 'registrado'.
create function public.registrar_mensaje_chat(
  p_conversacion_id uuid,
  p_limite_mensajes integer,
  p_ahora timestamptz default now()
)
returns table (resultado text, mensajes_usados integer, chat_id_retell text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_usados integer;
  v_chat text;
  v_terminada timestamptz;
begin
  if p_limite_mensajes is null or p_limite_mensajes < 0 or p_ahora is null then
    raise exception 'registrar_mensaje_chat: parámetros inválidos' using errcode = '22023';
  end if;

  update public.conversaciones_chat c set
    mensajes_usados = c.mensajes_usados + 1,
    ultimo_mensaje_en = p_ahora
  where c.id = p_conversacion_id
    and c.terminada_en is null
    and c.chat_id_retell is not null
    and c.mensajes_usados < p_limite_mensajes
  returning c.mensajes_usados, c.chat_id_retell into v_usados, v_chat;

  if found then
    return query select 'registrado'::text, v_usados, v_chat;
    return;
  end if;

  select c.mensajes_usados, c.chat_id_retell, c.terminada_en
  into v_usados, v_chat, v_terminada
  from public.conversaciones_chat c
  where c.id = p_conversacion_id;

  if not found then
    return query select 'no_encontrada'::text, null::integer, null::text;
  elsif v_terminada is not null then
    return query select 'terminada'::text, v_usados, null::text;
  elsif v_chat is null then
    return query select 'no_encontrada'::text, null::integer, null::text;
  else
    -- Límite alcanzado, o una causa que no se pudo determinar: se rechaza igual.
    return query select 'limite_alcanzado'::text, v_usados, null::text;
  end if;
end;
$$;

-- Devolver un mensaje
-- Resta el mensaje que la API contó cuando Retell falla después. Nunca baja de 0.
-- Devuelve el conteo resultante, o null si la conversación no existe.
create function public.devolver_mensaje_chat(p_conversacion_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_usados integer;
begin
  update public.conversaciones_chat c set mensajes_usados = c.mensajes_usados - 1
  where c.id = p_conversacion_id and c.mensajes_usados > 0
  returning c.mensajes_usados into v_usados;

  if found then
    return v_usados;
  end if;

  -- Ya estaba en 0 (se devuelve 0) o no existe (null).
  select c.mensajes_usados into v_usados
  from public.conversaciones_chat c
  where c.id = p_conversacion_id;

  return v_usados;
end;
$$;

-- Terminar una conversación
-- Marca la conversación como terminada. Devuelve true si estaba activa; false si ya estaba
-- terminada o no existe. También se usa cuando Retell falla al abrir (ver arriba).
create function public.terminar_conversacion_chat(
  p_conversacion_id uuid,
  p_ahora timestamptz default now()
)
returns boolean
language sql
set search_path = ''
as $$
  with actualizada as (
    update public.conversaciones_chat c set terminada_en = p_ahora
    where c.id = p_conversacion_id and c.terminada_en is null
    returning c.id
  )
  select exists (select 1 from actualizada);
$$;

-- Postgres deja ejecutar funciones a PUBLIC por defecto: se quita y solo la API puede llamarlas.
revoke execute on function public.abrir_conversacion_chat(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.abrir_conversacion_chat(integer, timestamptz) to service_role;

revoke execute on function public.asociar_chat_retell(uuid, text)
  from public, anon, authenticated;
grant execute on function public.asociar_chat_retell(uuid, text) to service_role;

revoke execute on function public.registrar_mensaje_chat(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.registrar_mensaje_chat(uuid, integer, timestamptz)
  to service_role;

revoke execute on function public.devolver_mensaje_chat(uuid)
  from public, anon, authenticated;
grant execute on function public.devolver_mensaje_chat(uuid) to service_role;

revoke execute on function public.terminar_conversacion_chat(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.terminar_conversacion_chat(uuid, timestamptz) to service_role;
