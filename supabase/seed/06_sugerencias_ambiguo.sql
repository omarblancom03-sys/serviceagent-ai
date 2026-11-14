-- Seed de sugerencia_ambiguo (US-15-P1, D72)
--
-- Qué platillo sugiere el agente cuando el cliente dice solo esa frase y queda ambiguo
-- ("una hamburguesa" → "¿Sería la Hamburguesa Granero?"). Lista aprobada por el PO el
-- 2026-11-14. Datos simulados: no hay ventas reales que digan qué es lo más común.
--
-- Sin sugerencia, a propósito, porque juntan cosas distintas: granero, pollo, natural, queso,
-- delicias, diabla, pescado, infantil y "con nieve". Ahí el agente pregunta nombrando las opciones.
--
-- Una frase por palabra: la API la normaliza, así que "papas" también vale para "papa" y
-- "camarones" para "camarón". Cada platillo tiene que salir entre las opciones de su frase; lo
-- prueba apps/api/test/sugerencias.test.ts.
--
-- Se buscan los ids por nombre porque este seed corre después de 01_menu_el_granero.sql. La lista
-- es la fuente única: en una sola sentencia, "retirados" borra las frases que ya no están en ella y
-- el insert agrega o actualiza las demás. Seguro de correr más de una vez.

with lista (frase, nombre_platillo) as (values
  ('hamburguesa', 'Hamburguesa Granero'),
  ('papas', 'Papas francesas'),
  ('tacos', 'Tacos de Arrachera'),
  ('taquiza', 'Taquiza Granero'),
  ('fajitas', 'Fajitas de arrachera'),
  ('filete', 'Filete de pescado empanizado'),
  ('caldo', 'Caldo de camarón'),
  ('ensalada', 'Ensalada Granero'),
  ('costillas', 'Costillas BBQ 450 gr'),
  ('camarones', 'Camarones al Ajillo'),
  ('parrillada', 'Parrillada Familiar'),
  ('cerveza', 'Cerveza nacional 355 ml'),
  ('pizerola', 'Pizerola de Sirloin'),
  ('limonada', 'Limonada natural')
),
retirados as (
  delete from sugerencia_ambiguo s
  where not exists (select 1 from lista l where l.frase = s.frase)
)
insert into sugerencia_ambiguo (frase, id_platillo)
select l.frase, p.id_platillo
from lista l
join platillo p on p.nombre = l.nombre_platillo
on conflict (frase) do update set id_platillo = excluded.id_platillo, activo = true;
