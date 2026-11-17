-- Ensayo manual de US-23: método de pago, referencia de transferencia y datos por WhatsApp
-- (migrations/20261117100000_metodo_pago_transferencia.sql, D76).
--
-- Para qué: probar crear_pedido con método y pedir_datos_whatsapp contra una base real, en tu
-- proyecto personal de Supabase o en el ensayo del PO antes del db push a serviceagent-dev.
-- Cómo: pega el archivo completo en el SQL Editor (o psql) y córrelo de una vez. Necesita las
-- migraciones hasta US-23 y el menú del seed (usa la primera variante activa que encuentre).
-- Resultado: la tabla final debe traer ok = true en todas las filas; si alguna falla, el bloque
-- de cierre lanza un error con los casos que fallaron.
--
-- NUNCA deja datos: todo va dentro de begin ... rollback (el cambio de modo también). La
-- secuencia de folios sí avanza: el rollback no la regresa.

begin;

create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;

-- Un renglón real del menú, con su precio, para que el total cuadre.
create temp table ensayo_renglon on commit drop as
select v.id_platillo, v.id_variante, p.nombre, v.nombre as variante, v.precio_centavos
from public.variante_producto v
join public.platillo p using (id_platillo)
where v.activo and p.activo and v.precio_centavos > 0
order by v.id_variante
limit 1;

-- crear_pedido con un renglón del menú. p_letra hace distinta la huella (y el pedido).
create function pg_temp.crear(p_letra text, p_telefono text, p_metodo text)
returns table (folio integer, estado text, ya_existia boolean, modo text, metodo text,
  referencia text, clabe text)
language sql
as $$
  select c.folio_asignado, c.estado_actual, c.ya_existia, c.modo_pago, c.metodo_pago,
    c.referencia_pago, c.clabe_transferencia
  from ensayo_renglon r,
  public.crear_pedido(
    'Prueba US-23 ' || p_letra,
    p_telefono,
    repeat(md5('US-23 ' || p_letra), 2),
    r.precio_centavos,
    jsonb_build_array(jsonb_build_object(
      'posicion', 0, 'tipo', 'platillo', 'id_platillo', r.id_platillo,
      'id_variante', r.id_variante, 'id_extra', null, 'nombre', r.nombre,
      'variante', r.variante, 'cantidad', 1, 'sin_ingredientes', '[]'::jsonb,
      'precio_unitario_centavos', r.precio_centavos, 'subtotal_centavos', r.precio_centavos,
      'extras', '[]'::jsonb
    )),
    10,
    p_metodo
  ) c;
$$;

create function pg_temp.anotar(p_caso text, p_esperado text, p_obtenido text)
returns void language sql as $$
  insert into ensayo_resultado values (p_caso, p_esperado, p_obtenido);
$$;

do $$
declare
  v record;
  v_folio_a integer;
  v_folio_t integer;
  v_ref text;
  v_texto text;
begin
  -- 1. Pago al recoger (valor inicial).
  select * into v from pg_temp.crear('A', '6140000001', 'tarjeta');
  v_folio_a := v.folio;
  perform pg_temp.anotar('01 al recoger: en cola con tarjeta, sin referencia ni CLABE',
    'en_cola, al_recoger, tarjeta, null, null',
    concat_ws(', ', v.estado, v.modo, v.metodo, coalesce(v.referencia, 'null'),
      coalesce(v.clabe, 'null')));

  begin
    perform pg_temp.crear('B', '6140000002', 'transferencia');
    v_texto := 'creó el pedido';
  exception when raise_exception then
    v_texto := 'rechazado';
  end;
  perform pg_temp.anotar('02 al recoger no acepta transferencia', 'rechazado', v_texto);

  begin
    perform pg_temp.crear('C', '6140000003', null);
    v_texto := 'creó el pedido';
  exception when raise_exception then
    v_texto := 'rechazado';
  end;
  perform pg_temp.anotar('03 al recoger sin método', 'rechazado', v_texto);

  -- 2. Transferencia. El update directo es solo del ensayo (lo deshace el rollback).
  update public.configuracion_restaurante set modo_pago = 'transferencia' where id;

  select * into v from pg_temp.crear('T', '6140000004', 'efectivo');
  v_folio_t := v.folio;
  v_ref := v.referencia;
  perform pg_temp.anotar('04 transferencia: espera el pago con método transferencia',
    'esperando_pago, transferencia, transferencia',
    concat_ws(', ', v.estado, v.modo, v.metodo));
  perform pg_temp.anotar('05 la referencia lleva el folio y 2 caracteres sin confusos', 'true',
    (v_ref ~ ('^GRN-' || v_folio_t || '-[ACDEFGHJKMNPQRTUVWXY34679]{2}$'))::text);
  perform pg_temp.anotar('06 devuelve la CLABE ficticia del restaurante', '999180157000000005',
    v.clabe);

  select * into v from pg_temp.crear('T', '6140000004', null);
  perform pg_temp.anotar('07 el duplicado devuelve la misma referencia',
    concat_ws(', ', v_folio_t, 'true', v_ref),
    concat_ws(', ', v.folio, v.ya_existia::text, v.referencia));

  perform pg_temp.anotar('08 el pedido de antes conserva su método aunque cambie el modo',
    'tarjeta', (select p.metodo_pago from public.pedidos p where p.folio = v_folio_a));

  -- 3. Restricciones.
  begin
    update public.pedidos p set referencia_pago = v_ref where p.folio = v_folio_a;
    v_texto := 'aceptó';
  exception when others then
    v_texto := 'rechazado';
  end;
  perform pg_temp.anotar('09 referencia repetida o sin transferencia', 'rechazado', v_texto);

  begin
    update public.configuracion_restaurante set clabe_transferencia = '12345' where id;
    v_texto := 'aceptó';
  exception when check_violation then
    v_texto := 'rechazado';
  end;
  perform pg_temp.anotar('10 una CLABE que no son 18 dígitos', 'rechazado', v_texto);

  -- 4. pedir_datos_whatsapp.
  perform pg_temp.anotar('11 whatsapp: primera vez', 'pedido, con hora',
    (select w.resultado || case when w.pedido_en is null then ', sin hora' else ', con hora' end
     from public.pedir_datos_whatsapp(v_folio_t, '6140000004') w));
  perform pg_temp.anotar('12 whatsapp: otra vez no repite', 'ya_pedido',
    (select w.resultado from public.pedir_datos_whatsapp(v_folio_t, '6140000004') w));
  perform pg_temp.anotar('13 whatsapp: otro teléfono', 'no_encontrado',
    (select w.resultado from public.pedir_datos_whatsapp(v_folio_t, '6149999999') w));
  perform pg_temp.anotar('14 whatsapp: pedido de pago en caja', 'no_aplica',
    (select w.resultado from public.pedir_datos_whatsapp(v_folio_a, '6140000001') w));

  -- 5. Permisos: solo service_role ejecuta las funciones.
  perform pg_temp.anotar('15 permisos de crear_pedido (anon, authenticated, service_role)',
    'false, false, true',
    concat_ws(', ',
      has_function_privilege('anon', 'public.crear_pedido(text, text, text, integer, jsonb, integer, text)', 'execute')::text,
      has_function_privilege('authenticated', 'public.crear_pedido(text, text, text, integer, jsonb, integer, text)', 'execute')::text,
      has_function_privilege('service_role', 'public.crear_pedido(text, text, text, integer, jsonb, integer, text)', 'execute')::text));
  perform pg_temp.anotar('16 permisos de pedir_datos_whatsapp (anon, authenticated, service_role)',
    'false, false, true',
    concat_ws(', ',
      has_function_privilege('anon', 'public.pedir_datos_whatsapp(integer, text)', 'execute')::text,
      has_function_privilege('authenticated', 'public.pedir_datos_whatsapp(integer, text)', 'execute')::text,
      has_function_privilege('service_role', 'public.pedir_datos_whatsapp(integer, text)', 'execute')::text));
  perform pg_temp.anotar('17 la función de 6 parámetros ya no existe', 'false',
    (to_regprocedure('public.crear_pedido(text, text, text, integer, jsonb, integer)') is not null)::text);
end $$;

-- 6. Como service_role, igual que la API: el SQL Editor corre como postgres y no notaría un
--    permiso que le falte a la API (error 42501). Los datos del renglón se leen antes de cambiar
--    de rol, porque service_role no ve las tablas temporales del ensayo.
do $$
declare
  r record;
  v_folio integer;
  v_estado text;
  v_whatsapp text;
begin
  select * into r from ensayo_renglon;
  set local role service_role;
  select c.folio_asignado, c.estado_actual into v_folio, v_estado
  from public.crear_pedido(
    'Prueba US-23 S', '6140000005', repeat(md5('US-23 S'), 2), r.precio_centavos,
    jsonb_build_array(jsonb_build_object(
      'posicion', 0, 'tipo', 'platillo', 'id_platillo', r.id_platillo,
      'id_variante', r.id_variante, 'id_extra', null, 'nombre', r.nombre,
      'variante', r.variante, 'cantidad', 1, 'sin_ingredientes', '[]'::jsonb,
      'precio_unitario_centavos', r.precio_centavos, 'subtotal_centavos', r.precio_centavos,
      'extras', '[]'::jsonb
    )),
    10, null) c;
  select w.resultado into v_whatsapp from public.pedir_datos_whatsapp(v_folio, '6140000005') w;
  reset role;
  insert into ensayo_resultado values
    ('18 como service_role: crea con referencia y anota whatsapp', 'esperando_pago, pedido',
     v_estado || ', ' || v_whatsapp);
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

-- Limpieza: deshace todo lo anterior (pedidos de prueba, cambio de modo y tablas temporales).
rollback;
