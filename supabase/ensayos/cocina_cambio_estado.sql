-- Ensayo manual de US-11-P1: cambiar_estado_cocina y deshacer_estado_cocina
-- (migrations/20261022100000_cocina_cambio_estado.sql, D56).
--
-- Para qué: probar las funciones contra una base real, en tu proyecto personal de Supabase o en
-- el ensayo de Omar antes del db push a serviceagent-dev. No lo corren las migraciones ni el seed.
-- Cómo: pega el archivo completo en el SQL Editor (o psql) y córrelo de una vez. Necesita las
-- migraciones hasta US-11-P1 y el seed de empleados (usa al empleado de cocina de prueba).
-- Resultado: la tabla final debe traer ok = true en todas las filas; si alguna falla, el bloque
-- de cierre lanza un error con los casos que fallaron.
--
-- NUNCA deja datos: todo va dentro de begin ... rollback. Si algo falla a la mitad, Postgres
-- aborta la transacción y tampoco se guarda nada. La señal de Realtime (D47) tampoco sale.
-- Dentro de una transacción now() no avanza: por eso el caso "fuera de plazo" mueve la hora del
-- historial hacia atrás en lugar de esperar.

begin;

-- Resultados de cada caso: se revisan al final.
create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;

-- Pedido de prueba, ya en la cola. No usa crear_pedido: desde US-08-P2-T1 exige la confirmación
-- del cliente en la conversación. El folio se guarda en una variable de la transacción.
with p as (
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado)
  values ('Prueba US-11', '6141234567', repeat('a', 64), 10000, 'en_cola')
  returning id_pedido, folio
), h as (
  insert into public.historial_estado_pedido (id_pedido, estado)
  select id_pedido, e from p, unnest(array['confirmado', 'en_cola']) as e
)
select set_config('ensayo.folio', folio::text, true) from p;

-- Empleado que hace los cambios (seed/empleados.sql).
select set_config(
  'ensayo.empleado',
  (select id::text from public.empleados where rol = 'cocina' order by creado_en limit 1),
  true
);

-- 01. Empezar: en_cola → preparando, con hora.
insert into ensayo_resultado
select '01. Empezar', 'preparando, con hora',
  (select estado_actual || case when cambiado_en is null then ', sin hora' else ', con hora' end
   from public.cambiar_estado_cocina(current_setting('ensayo.folio')::integer, 'en_cola',
     'preparando', current_setting('ensayo.empleado')::uuid));

-- 02. Doble toque: el segundo Empezar no cambia nada; trae el estado actual sin hora (409).
insert into ensayo_resultado
select '02. Doble toque de Empezar', 'preparando, sin hora',
  (select estado_actual || case when cambiado_en is null then ', sin hora' else ', con hora' end
   from public.cambiar_estado_cocina(current_setting('ensayo.folio')::integer, 'en_cola',
     'preparando', current_setting('ensayo.empleado')::uuid));

-- 03. Deshacer Empezar dentro del plazo: regresa a en_cola, motivo null.
insert into ensayo_resultado
select '03. Deshacer dentro del plazo', 'en_cola, null',
  (select estado_actual || ', ' || coalesce(motivo, 'null')
   from public.deshacer_estado_cocina(current_setting('ensayo.folio')::integer, 'preparando', 15));

-- 04. El historial perdió la fila de preparando; la de en_cola sigue igual.
insert into ensayo_resultado
select '04. Historial después de deshacer', 'confirmado,en_cola',
  (select string_agg(h.estado, ',' order by h.creado_en, h.id_historial)
   from public.historial_estado_pedido h
   join public.pedidos p using (id_pedido)
   where p.folio = current_setting('ensayo.folio')::integer);

-- 05. Empezar otra vez: preparando, con hora.
insert into ensayo_resultado
select '05. Empezar de nuevo', 'preparando, con hora',
  (select estado_actual || case when cambiado_en is null then ', sin hora' else ', con hora' end
   from public.cambiar_estado_cocina(current_setting('ensayo.folio')::integer, 'en_cola',
     'preparando', current_setting('ensayo.empleado')::uuid));

-- 06. Terminado: preparando → listo, con hora.
insert into ensayo_resultado
select '06. Terminado', 'listo, con hora',
  (select estado_actual || case when cambiado_en is null then ', sin hora' else ', con hora' end
   from public.cambiar_estado_cocina(current_setting('ensayo.folio')::integer, 'preparando',
     'listo', current_setting('ensayo.empleado')::uuid));

-- 07. Deshacer algo que no es lo último (preparando, si ya está listo): estado_distinto, sin cambio.
insert into ensayo_resultado
select '07. Deshacer algo que no es lo último', 'listo, estado_distinto',
  (select estado_actual || ', ' || coalesce(motivo, 'null')
   from public.deshacer_estado_cocina(current_setting('ensayo.folio')::integer, 'preparando', 15));

-- 08. Deshacer fuera del plazo: se mueve todo el historial 20 s atrás (el orden no cambia) y
-- deshacer listo con plazo de 15 s responde plazo_vencido, sin cambio.
update public.historial_estado_pedido h
set creado_en = h.creado_en - interval '20 seconds'
from public.pedidos p
where p.id_pedido = h.id_pedido and p.folio = current_setting('ensayo.folio')::integer;

insert into ensayo_resultado
select '08. Deshacer fuera del plazo', 'listo, plazo_vencido',
  (select estado_actual || ', ' || coalesce(motivo, 'null')
   from public.deshacer_estado_cocina(current_setting('ensayo.folio')::integer, 'listo', 15));

-- 09. Historial final: las filas de crear_pedido sin empleado; las de cocina con el empleado.
insert into ensayo_resultado
select '09. Historial con empleado',
  'confirmado:sistema,en_cola:sistema,preparando:empleado,listo:empleado',
  (select string_agg(
     h.estado || ':' || case
       when h.id_empleado is null then 'sistema'
       when h.id_empleado = current_setting('ensayo.empleado')::uuid then 'empleado'
       else 'otro'
     end,
     ',' order by h.creado_en, h.id_historial)
   from public.historial_estado_pedido h
   join public.pedidos p using (id_pedido)
   where p.folio = current_setting('ensayo.folio')::integer);

-- 10 y 11. Folio inexistente (los folios empiezan en 1001): cero filas en las dos funciones (404).
insert into ensayo_resultado
select '10. Empezar con folio inexistente', '(sin filas)',
  coalesce((select estado_actual from public.cambiar_estado_cocina(-1, 'en_cola', 'preparando',
    null)), '(sin filas)');

insert into ensayo_resultado
select '11. Deshacer con folio inexistente', '(sin filas)',
  coalesce((select estado_actual from public.deshacer_estado_cocina(-1, 'listo', 15)),
    '(sin filas)');

-- 12. Transición no permitida (en_cola → listo): error de la función, sin cambio.
do $$
declare
  v_obtenido text := 'sin error';
begin
  begin
    perform * from public.cambiar_estado_cocina(current_setting('ensayo.folio')::integer,
      'en_cola', 'listo', null);
  exception when raise_exception then
    v_obtenido := sqlerrm;
  end;
  insert into ensayo_resultado values ('12. Transición no permitida',
    'Cocina no puede pasar un pedido de en_cola a listo.', v_obtenido);
end $$;

-- 13 y 14. Plazo inválido (0 y 61 segundos): error de la función.
do $$
declare
  v_plazo integer;
  v_obtenido text;
begin
  foreach v_plazo in array array[0, 61] loop
    v_obtenido := 'sin error';
    begin
      perform * from public.deshacer_estado_cocina(current_setting('ensayo.folio')::integer,
        'listo', v_plazo);
    exception when raise_exception then
      v_obtenido := sqlerrm;
    end;
    insert into ensayo_resultado values (
      case v_plazo when 0 then '13. Plazo inválido (0 s)' else '14. Plazo inválido (61 s)' end,
      format('El plazo para deshacer debe ser de 1 a 60 segundos (llegó %s).', v_plazo),
      v_obtenido);
  end loop;
end $$;

-- Permisos: un segundo pedido de prueba, para no depender del estado del primero.
with p as (
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado)
  values ('Prueba US-11 permisos', '6141234567', repeat('b', 64), 10000, 'en_cola')
  returning id_pedido, folio
), h as (
  insert into public.historial_estado_pedido (id_pedido, estado)
  select id_pedido, e from p, unnest(array['confirmado', 'en_cola']) as e
)
select set_config('ensayo.folio_permisos', folio::text, true) from p;

-- 15 a 18. anon y authenticated no pueden ejecutar ninguna de las dos funciones (error 42501).
-- set local role se deshace solo al fallar el bloque interno; reset role lo asegura.
do $$
declare
  v_rol text;
  v_funcion text;
  v_obtenido text;
  v_numero integer := 15;
begin
  foreach v_rol in array array['anon', 'authenticated'] loop
    foreach v_funcion in array array['cambiar_estado_cocina', 'deshacer_estado_cocina'] loop
      v_obtenido := 'sin error';
      begin
        execute format('set local role %I', v_rol);
        if v_funcion = 'cambiar_estado_cocina' then
          perform * from public.cambiar_estado_cocina(
            current_setting('ensayo.folio_permisos')::integer, 'en_cola', 'preparando', null);
        else
          perform * from public.deshacer_estado_cocina(
            current_setting('ensayo.folio_permisos')::integer, 'preparando', 15);
        end if;
      exception when insufficient_privilege then
        v_obtenido := 'error 42501';
      end;
      reset role;
      insert into ensayo_resultado
      values (format('%s. %s: %s', v_numero, v_rol, v_funcion), 'error 42501', v_obtenido);
      v_numero := v_numero + 1;
    end loop;
  end loop;
end $$;

-- 19 y 20. service_role (el rol de la API) sí puede: Empezar y deshacerlo. Usa todos los grants
-- de la migración (update de estado, for update, insert y delete en el historial).
do $$
declare
  v_folio integer := current_setting('ensayo.folio_permisos')::integer;
  v_empezar text;
  v_deshacer text;
begin
  set local role service_role;
  select estado_actual || case when cambiado_en is null then ', sin hora' else ', con hora' end
  into v_empezar
  from public.cambiar_estado_cocina(v_folio, 'en_cola', 'preparando',
    current_setting('ensayo.empleado')::uuid);
  select estado_actual || ', ' || coalesce(motivo, 'null')
  into v_deshacer
  from public.deshacer_estado_cocina(v_folio, 'preparando', 15);
  reset role;
  insert into ensayo_resultado values
    ('19. service_role: Empezar', 'preparando, con hora', v_empezar),
    ('20. service_role: Deshacer', 'en_cola, null', v_deshacer);
end $$;

-- Doble deshacer: un tercer pedido de prueba, para no depender del estado de los otros dos.
with p as (
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado)
  values ('Prueba US-11 doble deshacer', '6141234567', repeat('c', 64), 10000, 'en_cola')
  returning id_pedido, folio
), h as (
  insert into public.historial_estado_pedido (id_pedido, estado)
  select id_pedido, e from p, unnest(array['confirmado', 'en_cola']) as e
)
select set_config('ensayo.folio_doble', folio::text, true) from p;

-- 21 a 25. Empezar, Terminado, deshacer listo y luego deshacer preparando, todo dentro del plazo:
-- el pedido regresa hasta en_cola y el historial queda como lo dejó crear_pedido (D56).
do $$
declare
  v_folio integer := current_setting('ensayo.folio_doble')::integer;
  v_empleado uuid := current_setting('ensayo.empleado')::uuid;
  v_empezar text;
  v_terminar text;
  v_deshacer_listo text;
  v_deshacer_preparando text;
begin
  select estado_actual || case when cambiado_en is null then ', sin hora' else ', con hora' end
  into v_empezar
  from public.cambiar_estado_cocina(v_folio, 'en_cola', 'preparando', v_empleado);
  select estado_actual || case when cambiado_en is null then ', sin hora' else ', con hora' end
  into v_terminar
  from public.cambiar_estado_cocina(v_folio, 'preparando', 'listo', v_empleado);
  select estado_actual || ', ' || coalesce(motivo, 'null')
  into v_deshacer_listo
  from public.deshacer_estado_cocina(v_folio, 'listo', 15);
  select estado_actual || ', ' || coalesce(motivo, 'null')
  into v_deshacer_preparando
  from public.deshacer_estado_cocina(v_folio, 'preparando', 15);
  insert into ensayo_resultado values
    ('21. Doble deshacer: Empezar', 'preparando, con hora', v_empezar),
    ('22. Doble deshacer: Terminado', 'listo, con hora', v_terminar),
    ('23. Doble deshacer: deshacer listo', 'preparando, null', v_deshacer_listo),
    ('24. Doble deshacer: deshacer preparando', 'en_cola, null', v_deshacer_preparando);
end $$;

insert into ensayo_resultado
select '25. Doble deshacer: historial', 'confirmado,en_cola',
  (select string_agg(h.estado, ',' order by h.creado_en, h.id_historial)
   from public.historial_estado_pedido h
   join public.pedidos p using (id_pedido)
   where p.folio = current_setting('ensayo.folio_doble')::integer);

-- Resultados: ok = true en todas las filas.
select caso, esperado, obtenido, obtenido is not distinct from esperado as ok
from ensayo_resultado
order by caso;

-- Cierre: si algún caso falló, error con la lista (y la transacción queda abortada, sin datos).
do $$
declare
  v_fallas text;
begin
  select string_agg(caso, '; ' order by caso) into v_fallas
  from ensayo_resultado
  where obtenido is distinct from esperado;
  if v_fallas is not null then
    raise exception 'Ensayo con fallas: %', v_fallas;
  end if;
  raise notice 'Ensayo correcto: % casos.', (select count(*) from ensayo_resultado);
end $$;

-- Limpieza: deshace todo lo anterior (pedidos de prueba, historial y tabla temporal).
rollback;
