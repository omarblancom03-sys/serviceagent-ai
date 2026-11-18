-- Ensayo manual de US-15-P1: tabla sugerencia_ambiguo y seed 06
-- (migrations/20261114100000_sugerencias_ambiguo.sql y seed/06_sugerencias_ambiguo.sql, D72).
--
-- Para qué: probar la tabla y el seed contra una base real, en tu proyecto personal de Supabase o
-- en serviceagent-dev. No lo corren las migraciones ni el seed.
-- Cómo: pega el archivo completo en el SQL Editor (o psql) y córrelo de una vez. Necesita la
-- migración de US-15-P1 y el seed del menú (01). Corre aquí mismo el seed 06 (la sentencia de
-- abajo es una copia: si cambia el seed, se cambia aquí) dos veces, con una frase retirada y otra
-- inactiva de por medio.
-- Resultado: la tabla final debe traer ok = true en todas las filas; si alguna falla, el bloque
-- de cierre lanza un error con los casos que fallaron.
--
-- NUNCA deja datos: todo va dentro de begin ... rollback.

begin;

create temp table ensayo_resultado (caso text, esperado text, obtenido text) on commit drop;

-- Copia de seed/06_sugerencias_ambiguo.sql (la lista del PO, ajustada el 2026-11-16).
create function pg_temp.correr_seed_06()
returns void
language sql
as $$
  with lista (frase, nombre_platillo) as (values
    ('hamburguesa', 'Hamburguesa Delicias'),
    ('papas', 'Papas francesas'),
    ('tacos', 'Tacos de Arrachera'),
    ('taquiza', 'Taquiza Granero'),
    ('fajitas', 'Fajitas de arrachera'),
    ('filete', 'Filete de pescado empanizado'),
    ('caldo', 'Caldo Granero'),
    ('ensalada', 'Ensalada Granero'),
    ('costillas', 'Costillas BBQ 450 gr'),
    ('camarones', 'Camarones al Ajillo'),
    ('parrillada', 'Parrillada Familiar'),
    ('cerveza', 'Cerveza nacional 355 ml'),
    ('pizerola', 'Pizerola de Sirloin'),
    ('limonada', 'Limonada natural')
  ),
  retirados as (
    delete from public.sugerencia_ambiguo s
    where not exists (select 1 from lista l where l.frase = s.frase)
  )
  insert into public.sugerencia_ambiguo (frase, id_platillo)
  select l.frase, p.id_platillo
  from lista l
  join public.platillo p on p.nombre = l.nombre_platillo
  on conflict (frase) do update set id_platillo = excluded.id_platillo, activo = true;
$$;

-- 1. Primera corrida: 14 frases, cada una con su platillo.
select pg_temp.correr_seed_06();
insert into ensayo_resultado
select '01. El seed deja 14 frases activas', '14',
  (select count(*) from public.sugerencia_ambiguo where activo)::text
union all
select '02. "hamburguesa" sugiere la Hamburguesa Delicias', 'Hamburguesa Delicias',
  (select p.nombre from public.sugerencia_ambiguo s join public.platillo p using (id_platillo)
   where s.frase = 'hamburguesa')
union all
select '03. "caldo" sugiere el Caldo Granero', 'Caldo Granero',
  (select p.nombre from public.sugerencia_ambiguo s join public.platillo p using (id_platillo)
   where s.frase = 'caldo')
union all
select '04. Ninguna frase apunta a un platillo que no existe', '0',
  (select count(*) from public.sugerencia_ambiguo s
   where not exists (select 1 from public.platillo p where p.id_platillo = s.id_platillo))::text;

-- 2. Una frase retirada y otra inactiva; la segunda corrida borra la primera y reactiva la otra.
insert into public.sugerencia_ambiguo (frase, id_platillo)
select 'frase retirada del ensayo', id_platillo from public.platillo order by id_platillo limit 1;
update public.sugerencia_ambiguo set activo = false where frase = 'tacos';
select pg_temp.correr_seed_06();
insert into ensayo_resultado
select '05. La segunda corrida borra la frase retirada', '0',
  (select count(*) from public.sugerencia_ambiguo where frase = 'frase retirada del ensayo')::text
union all
select '06. La segunda corrida reactiva una frase inactiva', 'true',
  (select activo::text from public.sugerencia_ambiguo where frase = 'tacos')
union all
select '07. La segunda corrida no duplica: siguen 14', '14',
  (select count(*) from public.sugerencia_ambiguo)::text;

-- 3. Restricciones.
do $$
begin
  begin
    insert into public.sugerencia_ambiguo (frase, id_platillo)
    select '   ', id_platillo from public.platillo order by id_platillo limit 1;
    insert into ensayo_resultado values ('08. Una frase en blanco no entra', 'check_violation', 'entró');
  exception when check_violation then
    insert into ensayo_resultado values ('08. Una frase en blanco no entra', 'check_violation', 'check_violation');
  end;
  begin
    insert into public.sugerencia_ambiguo (frase, id_platillo)
    select 'papas', id_platillo from public.platillo order by id_platillo limit 1;
    insert into ensayo_resultado values ('09. Una frase repetida no entra', 'unique_violation', 'entró');
  exception when unique_violation then
    insert into ensayo_resultado values ('09. Una frase repetida no entra', 'unique_violation', 'unique_violation');
  end;
end $$;

-- 4. RLS y permisos: RLS activo, sin políticas, solo service_role con select.
insert into ensayo_resultado
select '10. RLS activo', 'true',
  (select relrowsecurity::text from pg_class where oid = 'public.sugerencia_ambiguo'::regclass)
union all
select '11. Sin políticas', '0',
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sugerencia_ambiguo')::text
union all
select '12. service_role puede leer', 'true',
  has_table_privilege('service_role', 'public.sugerencia_ambiguo', 'select')::text
union all
select '13. service_role no puede escribir', 'false',
  (has_table_privilege('service_role', 'public.sugerencia_ambiguo', 'insert')
   or has_table_privilege('service_role', 'public.sugerencia_ambiguo', 'update')
   or has_table_privilege('service_role', 'public.sugerencia_ambiguo', 'delete'))::text
union all
select '14. anon y authenticated no leen', 'false',
  (has_table_privilege('anon', 'public.sugerencia_ambiguo', 'select')
   or has_table_privilege('authenticated', 'public.sugerencia_ambiguo', 'select'))::text;

select caso, esperado, obtenido, obtenido is not distinct from esperado as ok
from ensayo_resultado
order by caso;

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

-- Limpieza: deshace todo lo anterior.
rollback;
