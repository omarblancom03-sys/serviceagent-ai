-- Seed de ingrediente_removible (US-07-P1, D29)
--
-- Ingredientes que el cliente puede pedir quitar ("sin cebolla"), sin cambio
-- de precio. Lista aprobada por el PO: solo verduras y complementos que nombra
-- la descripción del platillo, nunca la carne. Excepción: la Hamburguesa
-- Delicias no permite quitar el tomate. Los platillos que no aparecen aquí no
-- permiten quitar nada. Datos simulados (no son la receta real).
--
-- Se buscan los ids por nombre (no fijos) porque este seed corre después de
-- 01_menu_el_granero.sql. La lista es la fuente única: en una sola sentencia,
-- "retirados" borra los ingredientes que ya no están en ella (si la lista
-- cambia, en bases como serviceagent-dev no quedan filas viejas, igual que los
-- sinónimos de D27) y el insert agrega los que faltan. ON CONFLICT DO NOTHING:
-- seguro de correr más de una vez sin duplicar (índice único
-- ingrediente_removible_unico); la segunda vez no borra ni agrega nada.

with lista (nombre_platillo, nombre) as (values
  -- Hamburguesas
  ('Hamburguesa Delicias', 'Lechuga'),
  ('Hamburguesa Delicias', 'Queso'),
  ('Hamburguesa Delicias Tocino', 'Lechuga'),
  ('Hamburguesa Delicias Tocino', 'Queso'),
  ('Hamburguesa Algodoneros', 'Lechuga'),
  ('Hamburguesa Algodoneros', 'Tomate'),
  ('Hamburguesa Algodoneros', 'Queso'),
  ('Hamburguesa Hawaiana', 'Lechuga'),
  ('Hamburguesa Hawaiana', 'Piña'),
  -- Ensaladas
  ('Ensalada Granero', 'Col morada'),
  ('Ensalada Granero', 'Tomate'),
  ('Ensalada Granero', 'Aguacate'),
  ('Ensalada Granero', 'Queso'),
  ('Ensalada Granero', 'Pepino'),
  ('Ensalada Natural', 'Tomate'),
  ('Ensalada Natural', 'Zanahoria'),
  ('Ensalada Natural', 'Pepino'),
  ('Ensalada Natural', 'Aguacate'),
  ('Ensalada Rancho', 'Pepino'),
  ('Ensalada Rancho', 'Tomate'),
  ('Ensalada Rancho', 'Aguacate'),
  ('Ensalada Rancho', 'Cebolla asada'),
  ('Ensalada Camarón', 'Col morada'),
  ('Ensalada Camarón', 'Tomate'),
  ('Ensalada Camarón', 'Aguacate'),
  ('Ensalada Camarón', 'Queso'),
  ('Ensalada Camarón', 'Pepino'),
  -- Tacos y taquizas
  ('El Granero', 'Morrón'),
  ('El Granero', 'Tomate'),
  ('El Granero', 'Cebolla'),
  ('Taquiza Alambre', 'Morrón'),
  ('Taquiza Alambre', 'Tomate'),
  ('Taquiza Alambre', 'Cebolla'),
  ('Taquiza Sirloin', 'Champiñones'),
  ('Taquiza Sirloin', 'Queso'),
  ('Taquiza Ranchera', 'Champiñones'),
  ('Taquiza Ranchera', 'Queso'),
  ('Tacos Rancheros', 'Champiñones'),
  ('Tacos Rancheros', 'Queso'),
  ('Tacos capeados', 'Habanero'),
  ('Tacos capeados', 'Aguacate'),
  -- Otros
  ('Sartencito', 'Morrón'),
  ('Sartencito', 'Cebolla'),
  ('Sartencito', 'Champiñones'),
  ('Sartencito', 'Tomate'),
  ('Caldo Granero', 'Aguacate'),
  ('Caldo Granero', 'Chipotle'),
  ('Caldito Granero', 'Aguacate'),
  ('Torre de mariscos', 'Pepino'),
  ('Torre de mariscos', 'Tomate'),
  ('Torre de mariscos', 'Cebolla'),
  ('Torre de mariscos', 'Cilantro'),
  ('Torre de mariscos', 'Jalapeño'),
  ('Torre de mariscos', 'Aguacate')
),
retirados as (
  delete from ingrediente_removible i
  using platillo p
  where i.id_platillo = p.id_platillo
    and not exists (
      select 1 from lista l where l.nombre_platillo = p.nombre and l.nombre = i.nombre
    )
)
insert into ingrediente_removible (id_platillo, nombre)
select p.id_platillo, l.nombre
from lista l
join platillo p on p.nombre = l.nombre_platillo
on conflict (id_platillo, nombre) do nothing;
