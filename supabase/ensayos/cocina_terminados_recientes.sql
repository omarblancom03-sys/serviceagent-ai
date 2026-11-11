-- Ensayo manual de US-52-P1: leer_terminados_cocina y regresar_pedido_cocina
-- (migrations/20261110100000_cocina_terminados_recientes.sql, D62).
--
-- Para qué: probar las funciones contra una base real, en tu proyecto personal de Supabase o en
-- el ensayo del PO antes del db push a serviceagent-dev. No lo corren las migraciones ni el seed.
-- Cómo: pega el archivo completo en el SQL Editor (o psql) y córrelo de una vez. Necesita las
-- migraciones hasta US-52-P1 y el seed de empleados (usa al empleado de cocina de prueba).
-- Resultado: la tabla final debe traer ok = true en todas las filas; si alguna falla, el bloque
-- de cierre lanza un error con los casos que fallaron.
--
-- NUNCA deja datos: todo va dentro de begin ... rollback. Si algo falla a la mitad, Postgres
-- aborta la transacción y tampoco se guarda nada. La señal de Realtime (D47) tampoco sale.
-- Dentro de una transacción now() no avanza: para simular "hace N minutos" se mueve la hora del
-- historial de cada pedido hacia atrás (el orden de sus filas no cambia).
-- Caja todavía no entrega pedidos (llega con US-21): el pedido "entregado" se arma con un update.
-- Los casos de leer_terminados_cocina solo miran los pedidos de este ensayo: si tu base tiene otros
-- pedidos en 'listo', no cambian el resultado.

begin;

-- Resultados de cada caso: se revisan al final.
create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;

-- Pedidos de este ensayo: una letra por pedido para leer los resultados.
create temp table ensayo_pedido (letra text primary key, folio integer not null) on commit drop;

-- Empleado que hace los cambios (seed/empleados.sql).
select set_config(
  'ensayo.empleado',
  (select id::text from public.empleados where rol = 'cocina' order by creado_en limit 1),
  true
);

-- Crea un pedido de prueba en la cola y lo lleva a p_estado: 'en_cola', 'listo' (Empezar y
-- Terminado con cambiar_estado_cocina), 'entregado' o 'cancelado' (listo y luego un update, como
-- lo harán caja y la cancelación). Después mueve todo su historial p_atras hacia atrás. No usa
-- crear_pedido: desde US-08-P2-T1 exige la confirmación del cliente en la conversación.
-- Vive en pg_temp: desaparece al cerrar la sesión.
create function pg_temp.pedido_ensayo(p_letra text, p_estado text, p_atras interval)
returns integer
language plpgsql
as $$
declare
  v_id_pedido integer;
  v_folio integer;
  v_empleado uuid := current_setting('ensayo.empleado')::uuid;
begin
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado)
  -- La huella debe ser hexadecimal de 64 caracteres: md5 de la letra, dos veces.
  values ('Prueba US-52 ' || p_letra, '6141234567', repeat(md5('US-52 ' || p_letra), 2), 10000,
    'en_cola')
  returning id_pedido, folio into v_id_pedido, v_folio;
  insert into public.historial_estado_pedido (id_pedido, estado)
  values (v_id_pedido, 'confirmado'), (v_id_pedido, 'en_cola');

  if p_estado <> 'en_cola' then
    perform * from public.cambiar_estado_cocina(v_folio, 'en_cola', 'preparando', v_empleado);
    perform * from public.cambiar_estado_cocina(v_folio, 'preparando', 'listo', v_empleado);
  end if;
  if p_estado in ('entregado', 'cancelado') then
    update public.pedidos p set estado = p_estado where p.id_pedido = v_id_pedido;
    insert into public.historial_estado_pedido (id_pedido, estado) values (v_id_pedido, p_estado);
  end if;

  update public.historial_estado_pedido h
  set creado_en = h.creado_en - p_atras
  where h.id_pedido = v_id_pedido;

  insert into ensayo_pedido values (p_letra, v_folio);
  return v_folio;
end;
$$;

-- Texto de una fila de regresar_pedido_cocina: "estado, motivo, con hora / sin hora".
create function pg_temp.texto_regresar(p_letra text, p_minutos integer)
returns text
language sql
as $$
  select coalesce(
    (select r.estado_actual || ', ' || coalesce(r.motivo, 'null') || case
       when r.cambiado_en is null then ', sin hora' else ', con hora' end
     from public.regresar_pedido_cocina(
       (select e.folio from ensayo_pedido e where e.letra = p_letra),
       current_setting('ensayo.empleado')::uuid,
       p_minutos) r),
    '(sin filas)');
$$;

-- Letras de los pedidos de este ensayo que devuelve leer_terminados_cocina, en su orden.
create function pg_temp.letras_terminados(p_minutos integer, p_limite integer)
returns text
language sql
as $$
  select coalesce(string_agg(e.letra, ',' order by t.n), '(ninguno)')
  from public.leer_terminados_cocina(p_minutos, p_limite)
    with ordinality as t(folio, terminado_en, n)
  join ensayo_pedido e using (folio);
$$;

-- Los pedidos. A y H terminados ahora (H tiene folio mayor), G hace 5 min, B hace 15 min 30 s
-- (ya no se ve, pero todavía se puede regresar: el margen de 16 min), C hace 17 min, D entregado,
-- E cancelado, F en la cola sin terminar.
select pg_temp.pedido_ensayo('A', 'listo', interval '0');
select pg_temp.pedido_ensayo('B', 'listo', interval '15 minutes 30 seconds');
select pg_temp.pedido_ensayo('C', 'listo', interval '17 minutes');
select pg_temp.pedido_ensayo('D', 'entregado', interval '0');
select pg_temp.pedido_ensayo('E', 'cancelado', interval '0');
select pg_temp.pedido_ensayo('F', 'en_cola', interval '0');
select pg_temp.pedido_ensayo('G', 'listo', interval '5 minutes');
select pg_temp.pedido_ensayo('H', 'listo', interval '0');

-- 01. Terminados recientes (15 min): solo A, G y H, del más reciente al más viejo; A y H con la
-- misma hora, el folio mayor primero. Fuera: B y C (más de 15 min), D, E y F (no están en listo).
insert into ensayo_resultado
select '01. Terminados: corte y orden', 'H,A,G', pg_temp.letras_terminados(15, 100);

-- 02. terminado_en es la hora del último Terminado (G: hace exactamente 5 min).
insert into ensayo_resultado
select '02. Terminados: hora de Terminado', 'true',
  (select (t.terminado_en = now() - interval '5 minutes')::text
   from public.leer_terminados_cocina(15, 100) t
   join ensayo_pedido e using (folio)
   where e.letra = 'G');

-- 03. El límite se respeta (cuenta todas las filas, también las que no son del ensayo).
insert into ensayo_resultado
select '03. Terminados: límite de 1', '1',
  (select count(*)::text from public.leer_terminados_cocina(15, 1));

-- 04. Regresar A (recién terminado, plazo de 16 min): preparando, con hora.
insert into ensayo_resultado
select '04. Regresar dentro del plazo', 'preparando, null, con hora',
  pg_temp.texto_regresar('A', 16);

-- 05. El historial de A gana una fila 'preparando' con el empleado; la de 'listo' se queda.
insert into ensayo_resultado
select '05. Historial después de regresar',
  'confirmado:sistema,en_cola:sistema,preparando:empleado,listo:empleado,preparando:empleado',
  (select string_agg(
     h.estado || ':' || case
       when h.id_empleado is null then 'sistema'
       when h.id_empleado = current_setting('ensayo.empleado')::uuid then 'empleado'
       else 'otro'
     end,
     ',' order by h.creado_en, h.id_historial)
   from public.historial_estado_pedido h
   join ensayo_pedido e on e.letra = 'A'
   join public.pedidos p on p.id_pedido = h.id_pedido and p.folio = e.folio);

-- 06. A ya no sale en terminados recientes.
insert into ensayo_resultado
select '06. Terminados sin el regresado', 'H,G', pg_temp.letras_terminados(15, 100);

-- 07. Regresar A otra vez (doble toque u otra tablet): estado_distinto, sin cambio.
insert into ensayo_resultado
select '07. Regresar dos veces', 'preparando, estado_distinto, sin hora',
  pg_temp.texto_regresar('A', 16);

-- 08. B se terminó hace 15 min 30 s: ya no se ve, pero el servidor lo acepta hasta 16 min.
insert into ensayo_resultado
select '08. Regresar en el margen (15:30)', 'preparando, null, con hora',
  pg_temp.texto_regresar('B', 16);

-- 09. C se terminó hace 17 min: plazo_vencido.
insert into ensayo_resultado
select '09. Regresar fuera del plazo (17 min)', 'listo, plazo_vencido, sin hora',
  pg_temp.texto_regresar('C', 16);

-- 10. C sigue en listo y su historial no ganó filas (confirmado, en_cola, preparando, listo).
insert into ensayo_resultado
select '10. Fuera del plazo no cambia nada', 'listo, 4 filas',
  (select p.estado || ', ' || count(h.*) || ' filas'
   from ensayo_pedido e
   join public.pedidos p on p.folio = e.folio
   join public.historial_estado_pedido h on h.id_pedido = p.id_pedido
   where e.letra = 'C'
   group by p.estado);

-- 11 a 13. Ya no está en listo: entregado (caja, US-21), cancelado o todavía en la cola.
insert into ensayo_resultado values
  ('11. Regresar un entregado', 'entregado, estado_distinto, sin hora',
    pg_temp.texto_regresar('D', 16)),
  ('12. Regresar un cancelado', 'cancelado, estado_distinto, sin hora',
    pg_temp.texto_regresar('E', 16)),
  ('13. Regresar uno en la cola', 'en_cola, estado_distinto, sin hora',
    pg_temp.texto_regresar('F', 16));

-- 14. El plazo cuenta desde el último Terminado: A (en preparando) se mueve 20 min atrás, se
-- vuelve a terminar ahora y se puede regresar otra vez.
update public.historial_estado_pedido h
set creado_en = h.creado_en - interval '20 minutes'
from ensayo_pedido e
join public.pedidos p on p.folio = e.folio
where e.letra = 'A' and h.id_pedido = p.id_pedido;

select * from public.cambiar_estado_cocina(
  (select folio from ensayo_pedido where letra = 'A'), 'preparando', 'listo',
  current_setting('ensayo.empleado')::uuid);

insert into ensayo_resultado
select '14. Plazo desde el último Terminado', 'preparando, null, con hora',
  pg_temp.texto_regresar('A', 16);

-- 15. Folio inexistente (los folios empiezan en 1001): cero filas (404).
insert into ensayo_resultado
select '15. Regresar con folio inexistente', '(sin filas)',
  coalesce((select estado_actual from public.regresar_pedido_cocina(-1,
    current_setting('ensayo.empleado')::uuid, 16)), '(sin filas)');

-- 16 a 22. Parámetros inválidos: error de la función, sin cambio.
do $$
declare
  v_folio integer := (select folio from ensayo_pedido where letra = 'H');
  v_empleado uuid := current_setting('ensayo.empleado')::uuid;
  v_caso record;
  v_obtenido text;
begin
  for v_caso in
    select * from (values
      ('16. Regresar sin empleado', 'regresar', null::integer, null::integer, true,
        'Falta el empleado que regresa el pedido.'),
      ('17. Regresar con plazo de 0 min', 'regresar', 0, null, false,
        'El plazo para regresar debe ser de 1 a 60 minutos (llegó 0).'),
      ('18. Regresar con plazo de 61 min', 'regresar', 61, null, false,
        'El plazo para regresar debe ser de 1 a 60 minutos (llegó 61).'),
      ('19. Terminados con 0 min', 'leer', 0, 20, false,
        'Los minutos de terminados recientes deben ser de 1 a 60 (llegó 0).'),
      ('20. Terminados con 61 min', 'leer', 61, 20, false,
        'Los minutos de terminados recientes deben ser de 1 a 60 (llegó 61).'),
      ('21. Terminados con límite 0', 'leer', 15, 0, false,
        'El límite de terminados recientes debe ser de 1 a 100 (llegó 0).'),
      ('22. Terminados con límite 101', 'leer', 15, 101, false,
        'El límite de terminados recientes debe ser de 1 a 100 (llegó 101).')
    ) as c(caso, funcion, minutos, limite, sin_empleado, esperado)
  loop
    v_obtenido := 'sin error';
    begin
      if v_caso.funcion = 'regresar' then
        perform * from public.regresar_pedido_cocina(v_folio,
          case when v_caso.sin_empleado then null else v_empleado end,
          coalesce(v_caso.minutos, 16));
      else
        perform * from public.leer_terminados_cocina(v_caso.minutos, v_caso.limite);
      end if;
    exception when raise_exception then
      v_obtenido := sqlerrm;
    end;
    insert into ensayo_resultado values (v_caso.caso, v_caso.esperado, v_obtenido);
  end loop;
end $$;

-- 23 a 26. anon y authenticated no pueden ejecutar ninguna de las dos funciones (error 42501).
-- set local role se deshace solo al fallar el bloque interno; reset role lo asegura.
do $$
declare
  v_folio integer := (select folio from ensayo_pedido where letra = 'H');
  v_rol text;
  v_funcion text;
  v_obtenido text;
  v_numero integer := 23;
begin
  foreach v_rol in array array['anon', 'authenticated'] loop
    foreach v_funcion in array array['leer_terminados_cocina', 'regresar_pedido_cocina'] loop
      v_obtenido := 'sin error';
      begin
        execute format('set local role %I', v_rol);
        if v_funcion = 'leer_terminados_cocina' then
          perform * from public.leer_terminados_cocina(15, 20);
        else
          perform * from public.regresar_pedido_cocina(v_folio,
            current_setting('ensayo.empleado')::uuid, 16);
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

-- 27 y 28. service_role (el rol de la API) sí puede: leer los terminados y regresar H. Usa los
-- grants que ya existían (select, insert y update de estado, también para el for update).
do $$
declare
  v_folio integer := (select folio from ensayo_pedido where letra = 'H');
  v_leer text;
  v_regresar text;
begin
  set local role service_role;
  select count(*)::text into v_leer
  from public.leer_terminados_cocina(15, 100) t
  where t.folio = v_folio;
  select r.estado_actual || ', ' || coalesce(r.motivo, 'null') || case
    when r.cambiado_en is null then ', sin hora' else ', con hora' end
  into v_regresar
  from public.regresar_pedido_cocina(v_folio, current_setting('ensayo.empleado')::uuid, 16) r;
  reset role;
  insert into ensayo_resultado values
    ('27. service_role: leer terminados', '1', v_leer),
    ('28. service_role: regresar', 'preparando, null, con hora', v_regresar);
end $$;

-- 29. El índice parcial de los pedidos en 'listo' existe.
insert into ensayo_resultado
select '29. Índice pedidos_estado_listo', 'existe',
  coalesce((select 'existe' from pg_indexes
    where schemaname = 'public' and indexname = 'pedidos_estado_listo'
      and indexdef like '%WHERE (estado = ''listo''::text)%'), 'no existe');

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

-- Limpieza: deshace todo lo anterior (pedidos de prueba, historial y tablas temporales). Las
-- funciones de pg_temp se borran solas al cerrar la sesión.
rollback;
