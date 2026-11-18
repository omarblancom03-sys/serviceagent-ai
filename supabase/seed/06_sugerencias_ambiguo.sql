-- Seed de sugerencia_ambiguo (US-15-P1, D72)
--
-- Qué platillo sugiere el agente cuando el cliente dice solo esa frase y queda ambiguo
-- ("una hamburguesa" → "¿Te refieres a la Hamburguesa Delicias?"). Lista aprobada por el PO el
-- 2026-11-14 y ajustada el 2026-11-16 (Martín): "hamburguesa" → Hamburguesa Delicias y "caldo" →
-- Caldo Granero. Datos simulados: como no hay ventas reales, el criterio es sugerir la opción más
-- sencilla o representativa de la casa, no la más cara.
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
--
-- Para retirar una frase, se quita de esta lista y se vuelve a correr el seed: la borra. Poner
-- `activo = false` a mano no dura: cada corrida la vuelve a dejar en `true`.

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
  delete from sugerencia_ambiguo s
  where not exists (select 1 from lista l where l.frase = s.frase)
)
insert into sugerencia_ambiguo (frase, id_platillo)
select l.frase, p.id_platillo
from lista l
join platillo p on p.nombre = l.nombre_platillo
on conflict (frase) do update set id_platillo = excluded.id_platillo, activo = true;
