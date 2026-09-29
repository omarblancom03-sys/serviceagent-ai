-- Seed de platillo_extra (US-02-P1)
--
-- Relaciona el extra "Espuelas (camarones)" con los 5 cortes de 450 gr que
-- lo permiten, segun ProductosRestaurante.MD. El propio comentario del seed
-- de extras (01_menu_el_granero.sql) ya senalaba que esta restriccion
-- faltaba en la base de datos ("esa restriccion no esta en la base de datos
-- y debe validarla el agente antes de confirmar"); esta migracion la agrega.
--
-- Los demas extras (Totopos, BBQ, Aguacate, Toreados) no tienen ninguna
-- restriccion de platillo en el menu fuente, asi que no llevan filas aqui
-- -- pendiente de confirmar con Omar si deben quedar disponibles para
-- cualquier platillo o si tambien necesitan reglas.
--
-- Se buscan los ids por nombre (no fijos) porque este seed corre despues
-- de 01_menu_el_granero.sql y depende de esos mismos nombres reales.
-- ON CONFLICT DO NOTHING: seguro de correr mas de una vez sin duplicar.

insert into platillo_extra (id_platillo, id_extra)
select p.id_platillo, e.id_extra
from (values
  ('T-Bone 450 gr'),
  ('Arrachera 450 gr'),
  ('Arrachera al Chipotle 450 gr'),
  ('Sirloin 450 gr'),
  ('Rib Eye 450 gr')
) as v(nombre_platillo)
join platillo p on p.nombre = v.nombre_platillo
join extra e on e.nombre = 'Espuelas (camarones)'
on conflict (id_platillo, id_extra) do nothing;
