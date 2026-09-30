-- US-02: tiempo estimado de preparacion, fijo por categoria (D18).
-- Datos simulados: el menu fuente no trae tiempos.
update platillo
set tiempo_estimado_min = v.minutos
from categoria_producto c
join (values
  ('De entradas al rancho', 15),
  ('Papas asadas', 20),
  ('Ensaladas', 15),
  ('Taquizas', 35),
  ('Producción de la granja', 25),
  ('Más con carnita', 30),
  ('Hamburguesas', 30),
  ('De nuestras mejores vacas', 35),
  ('A punta de tacos', 20),
  ('Pizerolas', 20),
  ('Mariscos', 30),
  ('Camarones', 25),
  ('Niños granjeros', 15),
  ('Bebidas', 5),
  ('Cervezas', 5),
  ('Postres', 10)
) as v(nombre, minutos) on c.nombre = v.nombre
where platillo.id_categoria = c.id_categoria;
