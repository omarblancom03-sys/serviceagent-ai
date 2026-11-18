-- Ensayo manual de US-14-P1: cancelar_pedido_cliente y la columna motivo del historial
-- (migrations/20261113100000_cancelar_pedido.sql, D71).
--
-- Para qué: probar la función contra una base real, en tu proyecto personal de Supabase o en el
-- ensayo del PO antes del db push a serviceagent-dev. No lo corren las migraciones ni el seed.
-- Cómo: pega el archivo completo en el SQL Editor (o psql) y córrelo de una vez. Necesita las
-- migraciones hasta US-14-P1; no necesita ningún seed.
-- Resultado: la tabla final debe traer ok = true en todas las filas; si alguna falla, el bloque
-- de cierre lanza un error con los casos que fallaron.
--
-- NUNCA deja datos: todo va dentro de begin ... rollback. Si algo falla a la mitad, Postgres
-- aborta la transacción y tampoco se guarda nada. La señal de Realtime (D47) tampoco sale.
-- Los pedidos se arman con insert y update directos, no con crear_pedido (exige la confirmación
-- del cliente en la conversación) ni con las funciones de cocina o caja: aquí solo importa en qué
-- estado está el pedido cuando llega la cancelación.

begin;

-- Resultados de cada caso: se revisan al final.
create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;

-- Pedidos de este ensayo: una letra por pedido para leer los resultados.
create temp table ensayo_pedido (letra text primary key, folio integer not null) on commit drop;

-- Crea un pedido de prueba del teléfono 6141234567 y lo deja en p_estado, con una fila de
-- historial por estado. Si p_pago > 0, le registra un pago en efectivo de ese monto.
-- Vive en pg_temp: desaparece al cerrar la sesión.
create function pg_temp.pedido_ensayo(p_letra text, p_estado text, p_pago integer default 0)
returns integer
language plpgsql
as $$
declare
  v_id_pedido integer;
  v_folio integer;
begin
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado)
  -- La huella debe ser hexadecimal de 64 caracteres: md5 de la letra, dos veces.
  values ('Prueba US-14 ' || p_letra, '6141234567', repeat(md5('US-14 ' || p_letra), 2), 10000,
    p_estado)
  returning id_pedido, folio into v_id_pedido, v_folio;
  insert into public.historial_estado_pedido (id_pedido, estado) values (v_id_pedido, p_estado);

  if p_pago > 0 then
    insert into public.pagos (id_pedido, metodo, monto_centavos)
    values (v_id_pedido, 'efectivo', p_pago);
  end if;

  insert into ensayo_pedido values (p_letra, v_folio);
  return v_folio;
end;
$$;

-- Texto de una fila de cancelar_pedido_cliente: "resultado, estado, con hora / sin hora".
create function pg_temp.texto_cancelar(p_letra text, p_telefono text, p_motivo text)
returns text
language sql
as $$
  select coalesce(
    (select c.resultado || ', ' || coalesce(c.estado_actual, 'null') || case
       when c.cancelado_en is null then ', sin hora' else ', con hora' end
     from public.cancelar_pedido_cliente(
       (select e.folio from ensayo_pedido e where e.letra = p_letra), p_telefono, p_motivo) c),
    '(sin filas)');
$$;

-- Estado del pedido y filas de su historial: "estado, N filas".
create function pg_temp.texto_pedido(p_letra text)
returns text
language sql
as $$
  select p.estado || ', ' || (
    select count(*) from public.historial_estado_pedido h where h.id_pedido = p.id_pedido
  ) || ' filas'
  from public.pedidos p
  join ensayo_pedido e using (folio)
  where e.letra = p_letra;
$$;

-- Los pedidos. A, B y C en los tres estados que se pueden cancelar; D a G en los que no; H en la
-- cola con un pago parcial; I listo y pagado; J para el teléfono equivocado; K para service_role;
-- L y M para los motivos que la tabla rechaza.
select pg_temp.pedido_ensayo('A', 'confirmado');
select pg_temp.pedido_ensayo('B', 'esperando_pago');
select pg_temp.pedido_ensayo('C', 'en_cola');
select pg_temp.pedido_ensayo('D', 'preparando');
select pg_temp.pedido_ensayo('E', 'listo');
select pg_temp.pedido_ensayo('F', 'entregado');
select pg_temp.pedido_ensayo('G', 'expirado');
select pg_temp.pedido_ensayo('H', 'en_cola', 5000);
select pg_temp.pedido_ensayo('I', 'listo', 10000);
select pg_temp.pedido_ensayo('J', 'en_cola');
select pg_temp.pedido_ensayo('K', 'en_cola');
select pg_temp.pedido_ensayo('L', 'en_cola');
select pg_temp.pedido_ensayo('M', 'en_cola');

-- 01 a 03. Se cancela desde confirmado, esperando_pago y en_cola.
insert into ensayo_resultado
select '01. Cancela desde confirmado', 'cancelado, cancelado, con hora',
  pg_temp.texto_cancelar('A', '6141234567', 'Ya no va a poder pasar.');
insert into ensayo_resultado
select '02. Cancela desde esperando_pago', 'cancelado, cancelado, con hora',
  pg_temp.texto_cancelar('B', '6141234567', 'Se equivocó de pedido.');
insert into ensayo_resultado
select '03. Cancela desde en_cola', 'cancelado, cancelado, con hora',
  pg_temp.texto_cancelar('C', '6141234567', 'Cambió de planes.');

-- 04. El pedido queda cancelado y con una fila más en el historial.
insert into ensayo_resultado
select '04. Pedido cancelado con su fila', 'cancelado, 2 filas', pg_temp.texto_pedido('C');

-- 05. Esa fila guarda el motivo, sin empleado (lo canceló el cliente) y con la hora de la base.
insert into ensayo_resultado
select '05. Historial: motivo, sin empleado, hora', 'Cambió de planes., null, true',
  (select h.motivo || ', ' || coalesce(h.id_empleado::text, 'null') || ', '
     || (h.creado_en = now())::text
   from public.historial_estado_pedido h
   join public.pedidos p using (id_pedido)
   join ensayo_pedido e using (folio)
   where e.letra = 'C' and h.estado = 'cancelado');

-- 06 y 07. Repetir la llamada no cambia nada: ni otra fila ni otro motivo.
insert into ensayo_resultado
select '06. Ya cancelado', 'ya_cancelado, cancelado, sin hora',
  pg_temp.texto_cancelar('C', '6141234567', 'Otra vez.');
insert into ensayo_resultado
select '07. Ya cancelado: sin otra fila', 'cancelado, 2 filas', pg_temp.texto_pedido('C');

-- 08 a 11. En preparación, listo, entregado o expirado no se cancela.
insert into ensayo_resultado
select '08. Preparando no se cancela', 'no_cancelable, preparando, sin hora',
  pg_temp.texto_cancelar('D', '6141234567', 'Motivo.');
insert into ensayo_resultado
select '09. Listo no se cancela', 'no_cancelable, listo, sin hora',
  pg_temp.texto_cancelar('E', '6141234567', 'Motivo.');
insert into ensayo_resultado
select '10. Entregado no se cancela', 'no_cancelable, entregado, sin hora',
  pg_temp.texto_cancelar('F', '6141234567', 'Motivo.');
insert into ensayo_resultado
select '11. Expirado no se cancela', 'no_cancelable, expirado, sin hora',
  pg_temp.texto_cancelar('G', '6141234567', 'Motivo.');

-- 12. Los rechazados siguen igual: mismo estado y solo su fila inicial.
insert into ensayo_resultado
select '12. Rechazado no cambia', 'preparando, 1 filas', pg_temp.texto_pedido('D');

-- 13 y 14. Con un pago (aunque sea parcial) no se cancela, y el pedido sigue en la cola.
insert into ensayo_resultado
select '13. Con pago no se cancela', 'con_pago, en_cola, sin hora',
  pg_temp.texto_cancelar('H', '6141234567', 'Motivo.');
insert into ensayo_resultado
select '14. Con pago no cambia', 'en_cola, 1 filas', pg_temp.texto_pedido('H');

-- 15. Listo y pagado: el estado se revisa antes que el pago.
insert into ensayo_resultado
select '15. Listo y pagado: gana el estado', 'no_cancelable, listo, sin hora',
  pg_temp.texto_cancelar('I', '6141234567', 'Motivo.');

-- 16 a 18. Otro teléfono y un folio que no existe responden lo mismo, y el pedido no cambia.
insert into ensayo_resultado
select '16. Folio de otro teléfono', 'no_encontrado, null, sin hora',
  pg_temp.texto_cancelar('J', '6149998877', 'Motivo.');
insert into ensayo_resultado
select '17. Folio que no existe', 'no_encontrado, null, sin hora',
  (select c.resultado || ', ' || coalesce(c.estado_actual, 'null') || case
     when c.cancelado_en is null then ', sin hora' else ', con hora' end
   from public.cancelar_pedido_cliente(2147483647, '6141234567', 'Motivo.') c);
insert into ensayo_resultado
select '18. El de otro teléfono no cambia', 'en_cola, 1 filas', pg_temp.texto_pedido('J');

-- 19 y 20. La tabla no acepta un motivo de más de 200 caracteres ni uno en blanco (la API ya los
-- detiene antes; esto es la segunda barrera). El error deshace también el update del pedido.
do $$
declare
  v_obtenido text := 'se guardó';
begin
  begin
    perform * from public.cancelar_pedido_cliente(
      (select e.folio from ensayo_pedido e where e.letra = 'L'), '6141234567', repeat('a', 201));
  exception when check_violation then
    v_obtenido := 'check_violation';
  end;
  insert into ensayo_resultado values ('19. Motivo de 201 caracteres', 'check_violation', v_obtenido);

  v_obtenido := 'se guardó';
  begin
    perform * from public.cancelar_pedido_cliente(
      (select e.folio from ensayo_pedido e where e.letra = 'M'), '6141234567', '   ');
  exception when check_violation then
    v_obtenido := 'check_violation';
  end;
  insert into ensayo_resultado values ('20. Motivo en blanco', 'check_violation', v_obtenido);
end $$;
insert into ensayo_resultado
select '21. Motivo rechazado: el pedido no cambia', 'en_cola, 1 filas', pg_temp.texto_pedido('L');

-- 22. Un motivo de exactamente 200 caracteres sí entra.
insert into ensayo_resultado
select '22. Motivo de 200 caracteres', 'cancelado, cancelado, con hora',
  pg_temp.texto_cancelar('L', '6141234567', repeat('a', 200));

-- 23. El motivo solo va en filas de cancelado.
do $$
declare
  v_obtenido text := 'se guardó';
begin
  begin
    insert into public.historial_estado_pedido (id_pedido, estado, motivo)
    select p.id_pedido, 'en_cola', 'No debería guardarse.'
    from public.pedidos p
    join ensayo_pedido e using (folio)
    where e.letra = 'M';
  exception when check_violation then
    v_obtenido := 'check_violation';
  end;
  insert into ensayo_resultado values ('23. Motivo en otro estado', 'check_violation', v_obtenido);
end $$;

-- 24 a 27. Permisos de la función: solo service_role.
insert into ensayo_resultado
select '24. service_role ejecuta', 'true',
  has_function_privilege(
    'service_role', 'public.cancelar_pedido_cliente(integer, text, text)', 'execute')::text;
insert into ensayo_resultado
select '25. anon no ejecuta', 'false',
  has_function_privilege(
    'anon', 'public.cancelar_pedido_cliente(integer, text, text)', 'execute')::text;
insert into ensayo_resultado
select '26. authenticated no ejecuta', 'false',
  has_function_privilege(
    'authenticated', 'public.cancelar_pedido_cliente(integer, text, text)', 'execute')::text;
insert into ensayo_resultado
select '27. public no ejecuta', 'false',
  has_function_privilege(
    'public', 'public.cancelar_pedido_cliente(integer, text, text)', 'execute')::text;

-- 28. Como service_role, igual que la API: cancelar de verdad, no solo tener el permiso de
-- ejecutar. El SQL Editor corre como postgres: sin este caso, un permiso que le falte a
-- service_role (bloquear la fila, leer pagos, escribir el motivo) solo se notaría en la API (42501).
do $$
declare
  v_folio integer := (select e.folio from ensayo_pedido e where e.letra = 'K');
  v_cancelar text;
begin
  set local role service_role;
  select c.resultado || ', ' || coalesce(c.estado_actual, 'null') into v_cancelar
  from public.cancelar_pedido_cliente(v_folio, '6141234567', 'Lo pidió por error.') c;
  reset role;
  insert into ensayo_resultado
  values ('28. service_role: cancelar', 'cancelado, cancelado', v_cancelar);
end $$;

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

-- Limpieza: deshace todo lo anterior (pedidos de prueba, pagos, historial y tablas temporales).
-- Las funciones de pg_temp se borran solas al cerrar la sesión.
rollback;
