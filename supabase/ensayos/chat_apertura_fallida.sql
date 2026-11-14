-- Ensayo manual de US-09-P1-T1: descartar_apertura_chat y el tope de abrir_conversacion_chat
-- (migrations/20261112100000_chat_apertura_fallida.sql, D64).
--
-- Para qué: probar las funciones contra una base real, en tu proyecto personal de Supabase o en
-- el ensayo del PO antes de aplicar la migración a serviceagent-dev.
-- Cómo: pega el archivo completo en el SQL Editor (o psql) y córrelo de una vez.
-- Resultado: la tabla final debe traer ok = true en todas las filas; si alguna falla, el bloque
-- de cierre lanza un error con los casos que fallaron.
--
-- NUNCA deja datos: todo va dentro de begin ... rollback. Usa un día lejano (1 de enero de 2031)
-- para que las conversaciones reales de hoy no cambien el conteo.

begin;

create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;
create temp table ensayo_conv (letra text primary key, id uuid) on commit drop;

-- Tope de 2: A y B entran, C ya no.
insert into ensayo_conv
select 'A', conversacion_id from public.abrir_conversacion_chat(2, '2031-01-01 18:00:00+00');
insert into ensayo_conv
select 'B', conversacion_id from public.abrir_conversacion_chat(2, '2031-01-01 18:01:00+00');

insert into ensayo_resultado
select '01 con el tope lleno no abre', 'tope_alcanzado', resultado
from public.abrir_conversacion_chat(2, '2031-01-01 18:02:00+00');

-- A se abrió bien en Retell; B no llegó a abrirse.
select public.asociar_chat_retell(
  (select id from ensayo_conv where letra = 'A'), 'chat_ensayo_us09p1t1_a'
);

insert into ensayo_resultado
select '02 no se descarta una conversación con chat', 'false',
  public.descartar_apertura_chat(
    (select id from ensayo_conv where letra = 'A'), '2031-01-01 18:03:00+00'
  )::text;

insert into ensayo_resultado
select '03 descarta la que no llegó a abrirse', 'true',
  public.descartar_apertura_chat(
    (select id from ensayo_conv where letra = 'B'), '2031-01-01 18:03:00+00'
  )::text;

insert into ensayo_resultado
select '04 descartar dos veces no hace nada', 'false',
  public.descartar_apertura_chat(
    (select id from ensayo_conv where letra = 'B'), '2031-01-01 18:04:00+00'
  )::text;

insert into ensayo_resultado
select '05 la descartada queda terminada, con su hora', 'true',
  (c.terminada_en is not null and c.apertura_fallida_en = '2031-01-01 18:03:00+00')::text
from public.conversaciones_chat c
where c.id = (select id from ensayo_conv where letra = 'B');

insert into ensayo_resultado
select '06 un id que no existe no descarta', 'false',
  public.descartar_apertura_chat(gen_random_uuid(), '2031-01-01 18:04:00+00')::text;

-- El lugar de B quedó libre: entra una más y la siguiente ya no.
insert into ensayo_resultado
select '07 la descartada libera su lugar', 'abierta', resultado
from public.abrir_conversacion_chat(2, '2031-01-01 18:05:00+00');

insert into ensayo_resultado
select '08 y el tope vuelve a aplicar', 'tope_alcanzado', resultado
from public.abrir_conversacion_chat(2, '2031-01-01 18:06:00+00');

insert into ensayo_resultado
select '09 anon no ejecuta descartar_apertura_chat', 'false',
  has_function_privilege(
    'anon', 'public.descartar_apertura_chat(uuid, timestamptz)', 'execute'
  )::text;

insert into ensayo_resultado
select '10 service_role sigue ejecutando abrir_conversacion_chat', 'true',
  has_function_privilege(
    'service_role', 'public.abrir_conversacion_chat(integer, timestamptz)', 'execute'
  )::text;

-- El SQL Editor corre como postgres: sin estos casos, un permiso que le falte a service_role
-- solo se notaría en la API (error 42501).
insert into ensayo_resultado
select '11 service_role actualiza apertura_fallida_en', 'true',
  has_column_privilege(
    'service_role', 'public.conversaciones_chat', 'apertura_fallida_en', 'UPDATE'
  )::text;

insert into ensayo_resultado
select '12 service_role actualiza terminada_en', 'true',
  has_column_privilege(
    'service_role', 'public.conversaciones_chat', 'terminada_en', 'UPDATE'
  )::text;

insert into ensayo_resultado
select '13 authenticated no ejecuta descartar_apertura_chat', 'false',
  has_function_privilege(
    'authenticated', 'public.descartar_apertura_chat(uuid, timestamptz)', 'execute'
  )::text;

insert into ensayo_resultado
select '14 public no ejecuta descartar_apertura_chat', 'false',
  has_function_privilege(
    'public', 'public.descartar_apertura_chat(uuid, timestamptz)', 'execute'
  )::text;

-- 15. Como service_role, igual que la API: descartar de verdad, no solo tener el permiso.
do $$
declare
  v_id uuid;
  v_descartada boolean;
begin
  set local role service_role;
  select conversacion_id into v_id
  from public.abrir_conversacion_chat(100, '2031-01-02 18:00:00+00');
  v_descartada := public.descartar_apertura_chat(v_id, '2031-01-02 18:01:00+00');
  reset role;
  insert into ensayo_resultado
  values ('15 service_role abre y descarta', 'true', v_descartada::text);
end $$;

select caso, esperado, obtenido, esperado = obtenido as ok from ensayo_resultado order by caso;

do $$
declare
  v_fallas text;
begin
  select string_agg(caso, '; ') into v_fallas from ensayo_resultado where esperado <> obtenido;
  if v_fallas is not null then
    raise exception 'Ensayo de US-09-P1-T1: fallaron: %', v_fallas;
  end if;
end;
$$;

rollback;
