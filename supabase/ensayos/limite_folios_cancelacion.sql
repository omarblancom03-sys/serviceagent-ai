-- Ensayo manual de US-14-T2: límite de folios no encontrados por conversación al cancelar
-- (migrations/20261118110000_limite_folios_cancelacion.sql, D79).
--
-- Para qué: probar intentos_cancelacion_chat y la nueva cancelar_pedido_cliente contra una base
-- real, en tu proyecto personal de Supabase o en el ensayo antes del db push a serviceagent-dev.
-- No lo corren las migraciones ni el seed.
-- Cómo: pega el archivo completo en el SQL Editor, o desde la raíz del repo:
--   pnpm dlx supabase@3.1.0 db query --linked -f supabase/ensayos/limite_folios_cancelacion.sql
-- Necesita las migraciones hasta US-14-T2; no necesita ningún seed.
-- Resultado: termina SIEMPRE con un error que trae la tabla completa de casos (así se ve también
-- desde la CLI, que solo muestra el error). Si empieza con "ENSAYO CORRECTO", pasaron todos; si
-- empieza con "ENSAYO CON FALLAS", las filas con FALLA dicen cuáles.
--
-- NUNCA deja datos: todo va dentro de begin ... y el error final aborta la transacción (el
-- rollback del final es por si alguien quita ese error). Los pedidos se arman con insert directo,
-- con el modo de pago fijado aquí para no depender de configuracion_restaurante.
--
-- Lo que este ensayo no puede probar es la carrera de dos llamadas a la vez sobre la misma
-- conversación (necesita dos sesiones). La función lo resuelve así (D14): primero crea la fila del
-- contador si falta (insert ... on conflict do nothing) y la bloquea (select ... for update), y
-- solo después busca el pedido. La segunda llamada espera a que la primera termine y lee el
-- contador ya sumado, así que ninguna se salta el límite.

begin;

-- Resultados de cada caso: se revisan al final.
create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;

-- Pedidos de este ensayo: una letra por pedido para leer los resultados.
create temp table ensayo_pedido (letra text primary key, folio integer not null) on commit drop;

-- Crea un pedido de prueba en p_estado, del teléfono p_telefono, con su fila de historial.
create function pg_temp.pedido_ensayo(p_letra text, p_estado text,
  p_telefono text default '6141234567')
returns integer
language plpgsql
as $$
declare
  v_id_pedido integer;
  v_folio integer;
begin
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado, modo_pago)
  values ('Prueba US-14-T2 ' || p_letra, p_telefono, repeat(md5('US-14-T2 ' || p_letra), 2),
    10000, p_estado, 'al_recoger')
  returning id_pedido, folio into v_id_pedido, v_folio;
  insert into public.historial_estado_pedido (id_pedido, estado) values (v_id_pedido, p_estado);
  insert into ensayo_pedido values (p_letra, v_folio);
  return v_folio;
end;
$$;

-- Folio de un pedido del ensayo, o uno que no existe ('X1', 'X2'…: del máximo entero hacia abajo).
create function pg_temp.folio(p_letra text)
returns integer
language sql
as $$
  select coalesce(
    (select e.folio from ensayo_pedido e where e.letra = p_letra),
    2147483647 - coalesce(nullif(substr(p_letra, 2), '')::integer, 0));
$$;

-- "resultado, estado" de cancelar_pedido_cliente con el límite de la API (3).
create function pg_temp.cancelar(p_chat text, p_letra text, p_telefono text default '6141234567')
returns text
language sql
as $$
  select coalesce(
    (select c.resultado || ', ' || coalesce(c.estado_actual, 'null')
     from public.cancelar_pedido_cliente(pg_temp.folio(p_letra), p_telefono, 'Motivo.', p_chat, 3) c),
    '(sin filas)');
$$;

-- "N, con hora / sin hora" del contador de una conversación.
create function pg_temp.contador(p_chat text)
returns text
language sql
as $$
  select coalesce(
    (select i.folios_no_encontrados || case
       when i.ultimo_no_encontrado_en is null then ', sin hora' else ', con hora' end
     from public.intentos_cancelacion_chat i
     where i.chat_id_retell = p_chat),
    '(sin fila)');
$$;

-- Estado de un pedido del ensayo.
create function pg_temp.estado(p_letra text)
returns text
language sql
as $$
  select p.estado from public.pedidos p join ensayo_pedido e using (folio) where e.letra = p_letra;
$$;

-- Los pedidos, todos en cola: A y B quedan detrás de un límite ya alcanzado; C se cancela con 2
-- no encontrados y D ya no; E se cancela en otra conversación; F, G y H son de otro teléfono;
-- K es para service_role.
select pg_temp.pedido_ensayo('A', 'en_cola');
select pg_temp.pedido_ensayo('B', 'en_cola');
select pg_temp.pedido_ensayo('C', 'en_cola');
select pg_temp.pedido_ensayo('D', 'en_cola');
select pg_temp.pedido_ensayo('E', 'en_cola');
select pg_temp.pedido_ensayo('F', 'en_cola', '6149998877');
select pg_temp.pedido_ensayo('G', 'en_cola', '6149998877');
select pg_temp.pedido_ensayo('H', 'en_cola', '6149998877');
select pg_temp.pedido_ensayo('K', 'en_cola');

-- 01. La firma vieja de 3 parámetros ya no existe.
insert into ensayo_resultado
select '01. Firma vieja borrada', 'null',
  coalesce(to_regprocedure('public.cancelar_pedido_cliente(integer, text, text)')::text, 'null');

-- 02 a 05. Permisos de la nueva: solo service_role.
insert into ensayo_resultado
select '02. service_role ejecuta', 'true', has_function_privilege('service_role',
  'public.cancelar_pedido_cliente(integer, text, text, text, integer)', 'execute')::text;
insert into ensayo_resultado
select '03. anon no ejecuta', 'false', has_function_privilege('anon',
  'public.cancelar_pedido_cliente(integer, text, text, text, integer)', 'execute')::text;
insert into ensayo_resultado
select '04. authenticated no ejecuta', 'false', has_function_privilege('authenticated',
  'public.cancelar_pedido_cliente(integer, text, text, text, integer)', 'execute')::text;
insert into ensayo_resultado
select '05. public no ejecuta', 'false', has_function_privilege('public',
  'public.cancelar_pedido_cliente(integer, text, text, text, integer)', 'execute')::text;

-- 06 a 08. La tabla: anon y authenticated no la leen, RLS activo, y sin folios ni teléfonos.
insert into ensayo_resultado
select '06. anon y authenticated no leen la tabla', 'false, false',
  has_table_privilege('anon', 'public.intentos_cancelacion_chat', 'select')::text || ', ' ||
  has_table_privilege('authenticated', 'public.intentos_cancelacion_chat', 'select')::text;
insert into ensayo_resultado
select '07. RLS activo', 'true',
  (select c.relrowsecurity::text from pg_class c
   where c.oid = 'public.intentos_cancelacion_chat'::regclass);
insert into ensayo_resultado
select '08. Columnas: sin folio ni teléfono',
  'chat_id_retell, creado_en, folios_no_encontrados, ultimo_no_encontrado_en',
  (select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
   where a.attrelid = 'public.intentos_cancelacion_chat'::regclass
     and a.attnum > 0 and not a.attisdropped);

-- 09 a 15. Tres folios que no existen: al cuarto intento, ni el folio correcto se cancela.
insert into ensayo_resultado
select '09. Chat 1: 1er folio inexistente', 'no_encontrado, null',
  pg_temp.cancelar('ensayo_us14t2_1', 'X1');
insert into ensayo_resultado
select '10. Chat 1: 2o folio inexistente', 'no_encontrado, null',
  pg_temp.cancelar('ensayo_us14t2_1', 'X2');
insert into ensayo_resultado
select '11. Chat 1: 3er folio inexistente', 'no_encontrado, null',
  pg_temp.cancelar('ensayo_us14t2_1', 'X3');
insert into ensayo_resultado
select '12. Chat 1: el folio correcto ya no se busca', 'demasiados_intentos, null',
  pg_temp.cancelar('ensayo_us14t2_1', 'A');
insert into ensayo_resultado
select '13. Chat 1: el pedido A no cambia', 'en_cola', pg_temp.estado('A');
insert into ensayo_resultado
select '14. Chat 1: otro inexistente tampoco', 'demasiados_intentos, null',
  pg_temp.cancelar('ensayo_us14t2_1', 'X4');
insert into ensayo_resultado
select '15. Chat 1: el contador se queda en 3', '3, con hora', pg_temp.contador('ensayo_us14t2_1');

-- 16 a 20. Folios que existen pero son de otro teléfono también cuentan: responden igual que uno
-- inexistente (D71), y si no contaran el límite delataría cuáles existen.
insert into ensayo_resultado
select '16. Chat 2: folio ajeno F', 'no_encontrado, null', pg_temp.cancelar('ensayo_us14t2_2', 'F');
insert into ensayo_resultado
select '17. Chat 2: folio ajeno G', 'no_encontrado, null', pg_temp.cancelar('ensayo_us14t2_2', 'G');
insert into ensayo_resultado
select '18. Chat 2: folio ajeno H', 'no_encontrado, null', pg_temp.cancelar('ensayo_us14t2_2', 'H');
insert into ensayo_resultado
select '19. Chat 2: los ajenos sumaron 3', '3, con hora', pg_temp.contador('ensayo_us14t2_2');
insert into ensayo_resultado
select '20. Chat 2: el pedido B ya no se busca', 'demasiados_intentos, null',
  pg_temp.cancelar('ensayo_us14t2_2', 'B');
insert into ensayo_resultado
select '21. Los ajenos y B no cambian', 'en_cola, en_cola, en_cola, en_cola',
  pg_temp.estado('F') || ', ' || pg_temp.estado('G') || ', ' || pg_temp.estado('H') || ', ' ||
  pg_temp.estado('B');

-- 22 a 26. Con 2 no encontrados todavía cancela, y encontrar el pedido no reinicia la cuenta.
insert into ensayo_resultado
select '22. Chat 3: 2 inexistentes', 'no_encontrado, null | no_encontrado, null',
  pg_temp.cancelar('ensayo_us14t2_3', 'X1') || ' | ' || pg_temp.cancelar('ensayo_us14t2_3', 'X2');
insert into ensayo_resultado
select '23. Chat 3: con 2 cancela C', 'cancelado, cancelado',
  pg_temp.cancelar('ensayo_us14t2_3', 'C');
insert into ensayo_resultado
select '24. Chat 3: cancelar no reinicia', '2, con hora', pg_temp.contador('ensayo_us14t2_3');
insert into ensayo_resultado
select '25. Chat 3: el 3er inexistente', 'no_encontrado, null',
  pg_temp.cancelar('ensayo_us14t2_3', 'X3');
insert into ensayo_resultado
select '26. Chat 3: D ya no se busca', 'demasiados_intentos, null',
  pg_temp.cancelar('ensayo_us14t2_3', 'D');

-- 27 y 28. Cada conversación lleva su cuenta: en otra, E se cancela y su contador no tiene hora.
insert into ensayo_resultado
select '27. Chat 4: cancela E', 'cancelado, cancelado', pg_temp.cancelar('ensayo_us14t2_4', 'E');
insert into ensayo_resultado
select '28. Chat 4: contador en 0', '0, sin hora', pg_temp.contador('ensayo_us14t2_4');

-- 29 a 33. Parámetros que la función rechaza: límite 0 o nulo, y un chat_id nulo, vacío o de
-- más de 128 caracteres (la API ya los filtra; esto es la segunda barrera).
do $$
declare
  v_obtenido text;
  v_casos text[] := array['29. Límite 0', '30. Límite nulo', '31. Chat nulo', '32. Chat vacío',
    '33. Chat de 129 caracteres'];
  v_esperados text[] := array['invalid_parameter_value', 'invalid_parameter_value',
    'not_null_violation', 'check_violation', 'check_violation'];
  v_chats text[] := array['ensayo_us14t2_5', 'ensayo_us14t2_5', null, '', repeat('a', 129)];
  v_limites integer[] := array[0, null, 3, 3, 3];
begin
  for i in 1..5 loop
    v_obtenido := 'sin error';
    begin
      perform * from public.cancelar_pedido_cliente(
        pg_temp.folio('X1'), '6141234567', 'Motivo.', v_chats[i], v_limites[i]);
    exception
      when invalid_parameter_value then v_obtenido := 'invalid_parameter_value';
      when not_null_violation then v_obtenido := 'not_null_violation';
      when check_violation then v_obtenido := 'check_violation';
    end;
    insert into ensayo_resultado values (v_casos[i], v_esperados[i], v_obtenido);
  end loop;
end $$;

-- 34. Como service_role, igual que la API: crear la fila, sumar y cancelar de verdad. El SQL
-- Editor corre como postgres: sin este caso, un permiso que le falte a service_role (insertar la
-- fila, bloquearla, sumar) solo se notaría en la API (42501).
do $$
declare
  v_no_encontrado text;
  v_cancelado text;
begin
  set local role service_role;
  select c.resultado into v_no_encontrado
  from public.cancelar_pedido_cliente(pg_temp.folio('X1'), '6141234567', 'Motivo.',
    'ensayo_us14t2_6', 3) c;
  select c.resultado into v_cancelado
  from public.cancelar_pedido_cliente(pg_temp.folio('K'), '6141234567', 'Motivo.',
    'ensayo_us14t2_6', 3) c;
  reset role;
  insert into ensayo_resultado values ('34. service_role: no encontrado, cancelar y contador',
    'no_encontrado, cancelado, 1, con hora',
    v_no_encontrado || ', ' || v_cancelado || ', ' || pg_temp.contador('ensayo_us14t2_6'));
end $$;

-- Resultados (para el SQL Editor): ok = true en todas las filas.
select caso, esperado, obtenido, obtenido is not distinct from esperado as ok
from ensayo_resultado
order by caso;

-- Cierre: SIEMPRE termina en error, con la tabla completa en el mensaje, y la transacción queda
-- abortada sin datos.
do $$
declare
  v_fallas integer;
  v_tabla text;
begin
  select count(*) filter (where obtenido is distinct from esperado),
    string_agg(
      case when obtenido is not distinct from esperado then 'ok    ' else 'FALLA ' end
        || caso || ' | esperado: ' || coalesce(esperado, 'null')
        || ' | obtenido: ' || coalesce(obtenido, 'null'),
      E'\n' order by caso)
  into v_fallas, v_tabla
  from ensayo_resultado;

  raise exception '%', case when v_fallas = 0
    then 'ENSAYO CORRECTO: ' || (select count(*) from ensayo_resultado) || ' casos (este error '
      || 'es a propósito: deshace todo).'
    else 'ENSAYO CON FALLAS: ' || v_fallas || ' de ' || (select count(*) from ensayo_resultado)
      || ' casos.'
  end || E'\n' || v_tabla;
end $$;

rollback;
