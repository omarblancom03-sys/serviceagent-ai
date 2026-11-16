-- Ensayo manual de US-21: cobrar_pedido_caja y entregar_pedido_caja
-- (migrations/20261112110000_caja_cobro_entrega.sql, D66).
--
-- Para qué: probar las funciones contra una base real, en tu proyecto personal de Supabase o en
-- el ensayo del PO antes del db push a serviceagent-dev. No lo corren las migraciones ni el seed.
-- Cómo: pega el archivo completo en el SQL Editor (o psql) y córrelo de una vez. Necesita las
-- migraciones hasta US-21 y el seed de empleados (usa al empleado de caja de prueba).
-- Resultado: la tabla final debe traer ok = true en todas las filas; si alguna falla, el bloque
-- de cierre lanza un error con los casos que fallaron.
--
-- NUNCA deja datos: todo va dentro de begin ... rollback. Si algo falla a la mitad, Postgres
-- aborta la transacción y tampoco se guarda nada. La señal de Realtime (D47) tampoco sale.

begin;

create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;
create temp table ensayo_pedido (letra text primary key, folio integer not null) on commit drop;

-- Empleado que cobra y entrega (seed/empleados.sql).
select set_config(
  'ensayo.empleado',
  (select id::text from public.empleados where rol = 'caja' order by creado_en limit 1),
  true
);

-- Crea un pedido de prueba de $100.00 directamente en p_estado (no usa crear_pedido: exige la
-- confirmación del cliente en la conversación). Vive en pg_temp: desaparece al cerrar la sesión.
create function pg_temp.pedido_ensayo(p_letra text, p_estado text)
returns integer
language plpgsql
as $$
declare
  v_id_pedido integer;
  v_folio integer;
begin
  insert into public.pedidos (nombre_cliente, telefono, huella, total_centavos, estado)
  values ('Prueba US-21 ' || p_letra, '6141234567', repeat(md5('US-21 ' || p_letra), 2), 10000,
    p_estado)
  returning id_pedido, folio into v_id_pedido, v_folio;
  insert into public.historial_estado_pedido (id_pedido, estado) values (v_id_pedido, p_estado);
  insert into ensayo_pedido values (p_letra, v_folio);
  return v_folio;
end;
$$;

create function pg_temp.folio(p_letra text) returns integer language sql as $$
  select e.folio from ensayo_pedido e where e.letra = p_letra;
$$;

-- "resultado, estado, monto" de cobrar_pedido_caja; "(sin filas)" si el folio no existe.
create function pg_temp.cobrar(p_folio integer, p_metodo text) returns text language sql as $$
  select coalesce(
    (select c.resultado || ', ' || c.estado_actual || ', ' || coalesce(c.cobrado_centavos::text, 'null')
       || case when c.cobrado_en is null then ', sin hora' else ', con hora' end
     from public.cobrar_pedido_caja(p_folio, p_metodo, current_setting('ensayo.empleado')::uuid) c),
    '(sin filas)');
$$;

-- "resultado, estado" de entregar_pedido_caja; "(sin filas)" si el folio no existe.
create function pg_temp.entregar(p_folio integer) returns text language sql as $$
  select coalesce(
    (select e.resultado || ', ' || e.estado_actual
       || case when e.entregado_en is null then ', sin hora' else ', con hora' end
     from public.entregar_pedido_caja(p_folio, current_setting('ensayo.empleado')::uuid) e),
    '(sin filas)');
$$;

-- A en la cola, B listo con un pago parcial de $40.00, C cancelado, D esperando pago, E entregado,
-- F listo sin pagar, G listo (lo usa service_role al final).
select pg_temp.pedido_ensayo('A', 'en_cola');
select pg_temp.pedido_ensayo('B', 'listo');
select pg_temp.pedido_ensayo('C', 'cancelado');
select pg_temp.pedido_ensayo('D', 'esperando_pago');
select pg_temp.pedido_ensayo('E', 'entregado');
select pg_temp.pedido_ensayo('F', 'listo');
select pg_temp.pedido_ensayo('G', 'listo');
insert into public.pagos (id_pedido, metodo, monto_centavos)
select p.id_pedido, 'transferencia', 4000 from public.pedidos p where p.folio = pg_temp.folio('B');

-- Cobrar
insert into ensayo_resultado values
  ('01. Cobra el total de un pedido en la cola', 'cobrado, en_cola, 10000, con hora',
    pg_temp.cobrar(pg_temp.folio('A'), 'efectivo'));

insert into ensayo_resultado
select '02. El pago guarda método, monto y empleado', 'efectivo, 10000, con empleado',
  (select g.metodo || ', ' || g.monto_centavos
     || case when g.id_empleado = current_setting('ensayo.empleado')::uuid
          then ', con empleado' else ', sin empleado' end
   from public.pagos g join public.pedidos p using (id_pedido)
   where p.folio = pg_temp.folio('A'));

insert into ensayo_resultado values
  ('03. No cobra dos veces', 'ya_pagado, en_cola, null, sin hora',
    pg_temp.cobrar(pg_temp.folio('A'), 'tarjeta'));

insert into ensayo_resultado
select '04. Sigue habiendo un solo pago', '1',
  (select count(*)::text from public.pagos g join public.pedidos p using (id_pedido)
   where p.folio = pg_temp.folio('A'));

insert into ensayo_resultado values
  ('05. Con un pago parcial cobra solo lo que falta', 'cobrado, listo, 6000, con hora',
    pg_temp.cobrar(pg_temp.folio('B'), 'tarjeta')),
  ('06. No cobra un pedido cancelado', 'estado_no_cobrable, cancelado, null, sin hora',
    pg_temp.cobrar(pg_temp.folio('C'), 'efectivo')),
  ('07. No cobra uno que espera transferencia', 'estado_no_cobrable, esperando_pago, null, sin hora',
    pg_temp.cobrar(pg_temp.folio('D'), 'efectivo')),
  ('08. No cobra uno entregado', 'estado_no_cobrable, entregado, null, sin hora',
    pg_temp.cobrar(pg_temp.folio('E'), 'efectivo')),
  ('09. Cobrar un folio que no existe', '(sin filas)', pg_temp.cobrar(-1, 'efectivo'));

-- 10. Caja no registra transferencias: la función lo rechaza con un error.
do $$
declare
  v_obtenido text := 'no falló';
begin
  begin
    perform pg_temp.cobrar(pg_temp.folio('F'), 'transferencia');
  exception when others then
    v_obtenido := 'error';
  end;
  insert into ensayo_resultado values ('10. Rechaza el método transferencia', 'error', v_obtenido);
end $$;

-- Entregar
insert into ensayo_resultado values
  ('11. No entrega un listo sin cobrar', 'falta_pago, listo, sin hora',
    pg_temp.entregar(pg_temp.folio('F'))),
  ('12. No entrega uno que no está listo, aunque esté pagado', 'estado_distinto, en_cola, sin hora',
    pg_temp.entregar(pg_temp.folio('A'))),
  ('13. Entrega un listo pagado', 'entregado, entregado, con hora',
    pg_temp.entregar(pg_temp.folio('B')));

insert into ensayo_resultado
select '14. El pedido queda entregado, con empleado y hora en el historial', 'entregado, con empleado',
  (select p.estado || case when h.id_empleado = current_setting('ensayo.empleado')::uuid
       then ', con empleado' else ', sin empleado' end
   from public.pedidos p
   join public.historial_estado_pedido h using (id_pedido)
   where p.folio = pg_temp.folio('B') and h.estado = 'entregado');

insert into ensayo_resultado values
  ('15. No entrega dos veces', 'estado_distinto, entregado, sin hora',
    pg_temp.entregar(pg_temp.folio('B'))),
  ('16. Entregar un folio que no existe', '(sin filas)', pg_temp.entregar(-1));

insert into ensayo_resultado
select '17. Una sola fila de entrega en el historial', '1',
  (select count(*)::text from public.historial_estado_pedido h join public.pedidos p using (id_pedido)
   where p.folio = pg_temp.folio('B') and h.estado = 'entregado');

-- Permisos: nadie más que service_role ejecuta las funciones.
insert into ensayo_resultado
select '18. Solo service_role ejecuta cobrar_pedido_caja', 'true, false, false, false',
  concat_ws(', ',
    has_function_privilege('service_role', 'public.cobrar_pedido_caja(integer, text, uuid)', 'execute')::text,
    has_function_privilege('anon', 'public.cobrar_pedido_caja(integer, text, uuid)', 'execute')::text,
    has_function_privilege('authenticated', 'public.cobrar_pedido_caja(integer, text, uuid)', 'execute')::text,
    has_function_privilege('public', 'public.cobrar_pedido_caja(integer, text, uuid)', 'execute')::text);

insert into ensayo_resultado
select '19. Solo service_role ejecuta entregar_pedido_caja', 'true, false, false, false',
  concat_ws(', ',
    has_function_privilege('service_role', 'public.entregar_pedido_caja(integer, uuid)', 'execute')::text,
    has_function_privilege('anon', 'public.entregar_pedido_caja(integer, uuid)', 'execute')::text,
    has_function_privilege('authenticated', 'public.entregar_pedido_caja(integer, uuid)', 'execute')::text,
    has_function_privilege('public', 'public.entregar_pedido_caja(integer, uuid)', 'execute')::text);

insert into ensayo_resultado
select '20. service_role no puede cambiar ni borrar pagos', 'false, false',
  concat_ws(', ',
    has_table_privilege('service_role', 'public.pagos', 'UPDATE')::text,
    has_table_privilege('service_role', 'public.pagos', 'DELETE')::text);

-- 21 y 22. Como service_role, igual que la API: el SQL Editor corre como postgres y no notaría un
-- permiso que le falte a la API (error 42501).
do $$
declare
  v_folio integer := pg_temp.folio('G');
  v_empleado uuid := current_setting('ensayo.empleado')::uuid;
  v_cobro text;
  v_entrega text;
begin
  set local role service_role;
  select c.resultado || ', ' || c.cobrado_centavos into v_cobro
  from public.cobrar_pedido_caja(v_folio, 'tarjeta', v_empleado) c;
  select e.resultado into v_entrega from public.entregar_pedido_caja(v_folio, v_empleado) e;
  reset role;
  insert into ensayo_resultado values
    ('21. service_role cobra', 'cobrado, 10000', v_cobro),
    ('22. service_role entrega', 'entregado', v_entrega);
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
rollback;
