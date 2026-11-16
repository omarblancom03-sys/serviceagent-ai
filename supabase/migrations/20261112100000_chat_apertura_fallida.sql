-- US-09-P1-T1: una conversación que no llegó a abrirse en Retell no gasta el tope diario (D64).
--
-- Hasta ahora, si Retell fallaba al abrir, la API terminaba la conversación y su lugar del tope
-- quedaba gastado (D39): una caída de Retell se acababa los lugares del día. Ahora la API la marca
-- como "apertura fallida" cuando Retell claramente no creó el chat, y el tope deja de contarla.
-- La fila no se borra: queda como registro de que hubo un intento.

alter table public.conversaciones_chat
  -- Null = se abrió bien, o falló de una forma en que Retell pudo crear el chat (se sigue contando).
  add column apertura_fallida_en timestamptz,
  -- Una apertura fallida nunca tuvo chat de Retell y siempre queda terminada.
  add constraint conversaciones_chat_apertura_fallida_check check (
    apertura_fallida_en is null or (chat_id_retell is null and terminada_en is not null)
  );

comment on column public.conversaciones_chat.apertura_fallida_en is
  'Cuándo se descartó porque Retell no creó el chat. Con valor, no cuenta en el tope diario.';

-- La función de abajo corre con los permisos de service_role (security invoker).
grant update (apertura_fallida_en) on table public.conversaciones_chat to service_role;

-- Abrir conversación: igual que antes, pero el tope no cuenta las aperturas fallidas.
-- `create or replace` conserva los permisos de la función (misma firma).
create or replace function public.abrir_conversacion_chat(
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
  where c.creado_en >= v_inicio and c.creado_en < v_fin
    and c.apertura_fallida_en is null;

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

-- Descartar una apertura
-- La API la llama cuando Retell rechazó `create-chat` sin procesarlo o la conexión falló antes de
-- recibir respuesta (el mismo criterio con que se devuelve un mensaje, D39). Marca la conversación
-- como apertura fallida y la termina en una sola sentencia. Solo aplica si nunca tuvo chat de
-- Retell: una conversación que sí se abrió no se puede descartar para recuperar su lugar.
-- Devuelve true si la descartó; false si no existe, ya tenía chat o ya estaba descartada.
create function public.descartar_apertura_chat(
  p_conversacion_id uuid,
  p_ahora timestamptz default now()
)
returns boolean
language sql
set search_path = ''
as $$
  with actualizada as (
    update public.conversaciones_chat c set
      apertura_fallida_en = p_ahora,
      terminada_en = coalesce(c.terminada_en, p_ahora)
    where c.id = p_conversacion_id
      and c.chat_id_retell is null
      and c.apertura_fallida_en is null
      and p_ahora is not null
    returning c.id
  )
  select exists (select 1 from actualizada);
$$;

revoke execute on function public.descartar_apertura_chat(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.descartar_apertura_chat(uuid, timestamptz) to service_role;
