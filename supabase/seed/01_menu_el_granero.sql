-- Seed del menu real de El Granero (US-02-P2)
-- Fuente: ProductosRestaurante.MD
-- Requiere que ya corriera 20260929100000_crear_esquema_menu.sql
--
-- Notas de transcripcion:
--   - tiempo_estimado_min no se carga aqui: el menu fuente no trae ese dato
--     y lo llena 03_tiempos_preparacion_menu.sql (fijo por categoria, D18).
--   - "platillo" no tiene precio propio (ver migracion): todo platillo
--     recibe al menos una variante. Los que no tienen opciones reales en
--     el menu llevan una sola variante llamada 'Unico'.
--   - Las 5 taquizas SI llevan 2 variantes (charros/refritos) aunque no
--     cambien de precio, porque el menu dice explicitamente "preguntar si
--     desea frijoles charros o refritos".
--   - 3 nombres se desambiguaron por colision entre categorias distintas,
--     usando los sinonimos que ya trae el propio menu:
--       * "Luiggi Especial" (papa asada, $204) -> 'Papa Luiggi Especial'
--       * "Fajitas de pollo" (infantil, $123)  -> 'Fajitas de pollo infantil'
--       * "Fajitas de arrachera" (infantil, $159) -> 'Fajitas de arrachera infantil'
--   - Otros 6 nombres de "Papas asadas" llevan el prefijo "Papa" (el menu
--     original los lista sin prefijo), para que no queden ambiguos frente
--     a otros platillos al buscar por nombre:
--       * "Natural" -> 'Papa Natural'        * "Elote" -> 'Papa con Elote'
--       * "Champiñón" -> 'Papa con Champiñón' * "Chorizo" -> 'Papa con Chorizo'
--       * "Tocino" -> 'Papa con Tocino'      * "Arrachera" -> 'Papa con Arrachera'
--   - Idempotente (revision de Omar, US-02-P2): requiere la migracion
--     20260929140000_restricciones_unicas_menu.sql (constraints unicos en
--     categoria_producto.nombre, platillo.nombre, variante_producto
--     (id_platillo, nombre) y extra.nombre). Correr este archivo mas de
--     una vez ya no duplica filas.
--   - El cargo "con espuelas" (+$55 en varios cortes) se modela como un
--     `extra`, no como variante. Los platillos donde aplica se relacionan
--     en platillo_extra (seed 02_platillo_extra.sql, US-02-P1).

-- =====================================================================
-- 1) CATEGORIAS
-- =====================================================================
insert into categoria_producto (nombre) values
  ('De entradas al rancho'),
  ('Papas asadas'),
  ('Ensaladas'),
  ('Taquizas'),
  ('Producción de la granja'),
  ('Más con carnita'),
  ('Hamburguesas'),
  ('De nuestras mejores vacas'),
  ('A punta de tacos'),
  ('Pizerolas'),
  ('Mariscos'),
  ('Camarones'),
  ('Niños granjeros'),
  ('Bebidas'),
  ('Cervezas'),
  ('Postres')
on conflict (nombre) do nothing;

-- =====================================================================
-- 2) PLATILLOS (categoria por nombre, para no depender de ids fijos)
-- =====================================================================
insert into platillo (id_categoria, nombre, descripcion)
select c.id_categoria, v.nombre, v.descripcion
from (values
  -- De entradas al rancho
  ('De entradas al rancho', 'Rajas con queso', 'Entrada de rajas de chile servidas con queso. No incluye acompañamientos adicionales.'),
  ('De entradas al rancho', 'Guacamole', 'Guacamole servido como entrada. Incluye totopos.'),
  ('De entradas al rancho', 'Papas francesas', 'Orden de papas a la francesa. No incluye acompañamientos adicionales.'),
  ('De entradas al rancho', 'Orden de salchichas', 'Orden de salchichas. No incluye acompañamientos adicionales.'),
  ('De entradas al rancho', 'Frijoles charros', 'Orden de frijoles charros. No incluye acompañamientos adicionales.'),
  ('De entradas al rancho', 'Elote amarillo', 'Elote amarillo servido como entrada. No incluye acompañamientos adicionales.'),
  ('De entradas al rancho', 'Queso fundido', 'Queso fundido con opción de preparación natural o con ingrediente adicional. No incluye acompañamientos adicionales.'),
  ('De entradas al rancho', 'Luiggi Especial', 'Queso Chihuahua con camarones. No incluye acompañamientos adicionales.'),
  ('De entradas al rancho', 'Orden de chiles', 'Chiles abiertos preparados con queso y elote. No incluye acompañamientos adicionales.'),
  -- Papas asadas
  ('Papas asadas', 'Papa Natural', 'Papa asada en su preparación natural. No incluye acompañamientos adicionales.'),
  ('Papas asadas', 'Papa con Elote', 'Papa asada con elote. No incluye acompañamientos adicionales.'),
  ('Papas asadas', 'Papa con Champiñón', 'Papa asada con champiñón. No incluye acompañamientos adicionales.'),
  ('Papas asadas', 'Papa con Chorizo', 'Papa asada con chorizo. No incluye acompañamientos adicionales.'),
  ('Papas asadas', 'Papa con Tocino', 'Papa asada con tocino. No incluye acompañamientos adicionales.'),
  ('Papas asadas', 'Papa con Arrachera', 'Papa asada con arrachera. No incluye acompañamientos adicionales.'),
  ('Papas asadas', 'Papa Luiggi Especial', 'Papa asada especial con camarón. No incluye acompañamientos adicionales.'),
  -- Ensaladas
  ('Ensaladas', 'Ensalada Granero', 'Mezcla de lechuga con pechuga de pollo a la plancha, col morada, tomate, aguacate, queso y pepino. Incluye aderezo.'),
  ('Ensaladas', 'Ensalada Natural', 'Lechuga combinada con tomate, zanahoria, pepino y aguacate. Incluye aderezo de la casa.'),
  ('Ensaladas', 'Ensalada Rancho', 'Mezcla de lechuga, pepino, tomate, aguacate, cebolla asada y arrachera. No incluye acompañamientos adicionales.'),
  ('Ensaladas', 'Ensalada Camarón', 'Ensalada con camarones sazonados a la mantequilla, lechuga, col morada, tomate, aguacate, queso y pepino. Incluye aderezo.'),
  -- Taquizas (800 gr / 4 personas)
  ('Taquizas', 'Taquiza Sirloin', 'Taquiza para compartir preparada con sirloin, tocino, champiñones y queso. Montada sobre cebollas asadas.'),
  ('Taquizas', 'Taquiza Granero', 'Taquiza de la casa. Montada sobre cebollas asadas.'),
  ('Taquizas', 'Taquiza del Mar', 'Taquiza preparada con sirloin, camarones y queso. Montada sobre cebollas asadas.'),
  ('Taquizas', 'Taquiza Ranchera', 'Taquiza con sirloin, chorizo, champiñones y queso. Montada sobre cebollas asadas.'),
  ('Taquizas', 'Taquiza Alambre', 'Taquiza con sirloin y una mezcla de morrón, tomate, cebolla y panceta de puerco. Montada sobre cebollas asadas.'),
  -- Producción de la granja
  ('Producción de la granja', 'Caldo Granero', 'Caldo con pechuga de pollo, arroz norteño, asadero, aguacate y chipotle. No incluye acompañamientos adicionales.'),
  ('Producción de la granja', 'Sartencito', 'Sirloin a la parrilla en trozos combinado con morrón, cebolla, champiñón y tomate, gratinado con queso. No incluye acompañamientos adicionales.'),
  ('Producción de la granja', 'Guisado Abigeo', 'Carne de res seca al sol en combinación de cuatro chiles colorados. Acompañado con frijoles refritos con queso.'),
  ('Producción de la granja', 'Platillo Granero', 'Combinación de arrachera, chile relleno, enchilada roja, arroz y frijoles de la casa. Incluye una tostada mexicana crujiente.'),
  -- Más con carnita
  ('Más con carnita', 'Costillas Chihuahua', 'Costillas de puerco cocidas al horno y bañadas en salsa. Acompañadas con elote fresco y papas fritas.'),
  ('Más con carnita', 'Fajitas de arrachera', 'Fajitas de arrachera. Acompañadas de arroz, papas a la francesa y verduras.'),
  ('Más con carnita', 'Enchiladas Las Vírgenes', 'Enchiladas que pueden pedirse de pollo o de queso. Acompañadas de arroz, frijoles y ensalada.'),
  ('Más con carnita', 'Fajitas Trío', 'Combinación de arrachera marinada, pechuga de pollo y camarones servidos sobre una cama de pimientos. Acompañadas de guacamole.'),
  ('Más con carnita', 'Fajitas de pollo', 'Fajitas de pollo. Acompañadas de arroz, papas a la francesa y verduras.'),
  ('Más con carnita', 'Tiras de pollo', 'Pechuga de pollo con empanizado de la casa. Acompañada de vegetales y aderezo de la casa.'),
  -- Hamburguesas (todas acompañadas de papas)
  ('Hamburguesas', 'Delicias', 'Hamburguesa sencilla con lechuga fresca, tomate y queso. Acompañada de papas.'),
  ('Hamburguesas', 'Delicias Tocino', 'Hamburguesa sencilla con tocino, lechuga fresca y queso. Acompañada de papas.'),
  ('Hamburguesas', 'Granero', 'Hamburguesa bañada en salsa BBQ con tocino. Acompañada de papas.'),
  ('Hamburguesas', 'Pollo', 'Hamburguesa con pechuga de pollo a la parrilla y verduras. Acompañada de papas.'),
  ('Hamburguesas', 'Algodoneros', 'Hamburguesa de doble carne con lechuga fresca, tomate y queso. Acompañada de papas.'),
  ('Hamburguesas', 'Hawaiana', 'Hamburguesa sencilla con lechuga fresca y piña. Acompañada de papas.'),
  -- De nuestras mejores vacas
  ('De nuestras mejores vacas', 'Parrillada Familiar', 'Parrillada para compartir con costilla, sirloin, arrachera, dos salchichas asadas, tiras de pollo y fajitas de pollo. Incluye frijoles charros, arroz y elote.'),
  ('De nuestras mejores vacas', 'Parrillada Mar y Tierra', 'Parrillada para aproximadamente seis personas con costilla, sirloin, arrachera, dos salchichas asadas, dos filetes de pescado empanizado, dos brochetas de camarón, tiras de pollo y fajitas de pollo. Incluye frijoles charros, arroz, elote, ensalada y papas francesas.'),
  ('De nuestras mejores vacas', 'Parrillada 1 kg', 'Parrillada de un kilogramo. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'T-Bone 450 gr', 'Corte T-Bone de 450 gramos. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Arrachera 450 gr', 'Corte de arrachera de 450 gramos. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Arrachera al Chipotle 450 gr', 'Arrachera de 450 gramos preparada al chipotle. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Sirloin 450 gr', 'Corte de sirloin de 450 gramos. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Rib Eye 450 gr', 'Corte Rib Eye de 450 gramos. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Cowboy 450 gr', 'Corte Cowboy de 450 gramos. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Costillas 450 gr', 'Porción de costillas de 450 gramos. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Costillas BBQ 450 gr', 'Costillas de 450 gramos con salsa BBQ. No incluye acompañamientos adicionales.'),
  ('De nuestras mejores vacas', 'Costillas a la Diabla', 'Costillas preparadas a la diabla. No incluye acompañamientos adicionales.'),
  -- A punta de tacos
  ('A punta de tacos', 'La Boquilla', 'Tacos de sirloin. Acompañados de ensalada verde, cebollas asadas y frijoles charros.'),
  ('A punta de tacos', 'Tacos Rancheros', 'Tacos de sirloin con chorizo, champiñones y queso Chihuahua. Acompañados de frijoles charros.'),
  ('A punta de tacos', 'Villalba', 'Tacos de costilla. Acompañados de ensalada verde, cebollitas asadas y frijoles charros.'),
  ('A punta de tacos', 'Tacos de Arrachera', 'Orden de cuatro tacos de arrachera. Acompañados de frijoles charros.'),
  ('A punta de tacos', 'El Granero', 'Tacos de alambre con sirloin, tocino, morrón, tomate, cebolla y queso. Acompañados de frijoles charros.'),
  ('A punta de tacos', 'Taco Delicias', 'Taco grande en tortilla gorda de harina. Acompañado de ensalada, cebollas asadas y frijoles charros.'),
  -- Pizerolas
  ('Pizerolas', 'Pizerola de Sirloin', 'Tortilla de harina gorda con carne de sirloin, preparada en forma de pizza y gratinada con queso Chihuahua. No incluye acompañamientos adicionales.'),
  ('Pizerolas', 'Pizerola de Alambre', 'Tortilla de harina gorda con carne de sirloin y vegetales asados, gratinada con queso Chihuahua. No incluye acompañamientos adicionales.'),
  -- Mariscos
  ('Mariscos', 'Filete de pescado empanizado', 'Filete de pescado empanizado. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Filete a la mantequilla', 'Filete de pescado preparado a la mantequilla. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Filete al ajillo', 'Filete de pescado preparado al ajillo. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Filete en crema de champiñones', 'Filete de pescado servido en crema de champiñones. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Filete a la diabla', 'Filete de pescado preparado a la diabla. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Torre de mariscos', 'Platillo para compartir con camarones frescos en cubos, pulpo, callo de hacha, pepino, tomate, cebolla, cilantro y jalapeño. Aderezado con jugo de limón, mezcla de salsas y aguacate.'),
  ('Mariscos', 'Caldo de pescado', 'Caldo de pescado. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Caldo de oso', 'Caldo de Oso. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Caldo de camarón', 'Caldo de camarón. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Cóctel de camarón', 'Cóctel de camarón disponible en dos tamaños. No incluye acompañamientos adicionales.'),
  ('Mariscos', 'Tacos capeados', 'Orden de tres tacos capeados en tortilla grande de maíz con costra de queso. Servidos con ensalada de col, toque de habanero, aguacate, alioli de chipotle y consomé de pescado como entrada.'),
  -- Camarones
  ('Camarones', 'Camarones al Ajillo', 'Camarones fritos en mantequilla con ajo fresco. Acompañados de ensalada verde, arroz y papas francesas.'),
  ('Camarones', 'Camarones a la Diabla', 'Camarones bañados en una combinación de chipotle, salsa de tomate y especias. Acompañados de ensalada verde, arroz y papas francesas.'),
  ('Camarones', 'Camarones Fiesta', 'Camarones rellenos de queso cheddar y envueltos en tocino crujiente. Acompañados de ensalada verde, arroz y papas francesas.'),
  ('Camarones', 'Camarones Empanizados', 'Camarones con empanizado crujiente y sazonador de hierbas secas. Acompañados de ensalada verde, arroz y papas francesas.'),
  ('Camarones', 'Camarones a la Crema', 'Camarones en crema de leche con salsa de champiñones a la mantequilla. Acompañados de ensalada verde, arroz y papas francesas.'),
  ('Camarones', 'Camarones al Coco', 'Camarones empanizados al coco. Acompañados de arroz blanco y ensalada con aderezo de frutos rojos al chipotle.'),
  -- Niños granjeros
  ('Niños granjeros', 'Fajitas de pollo infantil', 'Pechuga de pollo en fajitas a la parrilla. Acompañada de papas a la francesa y arroz.'),
  ('Niños granjeros', 'Filete de pescado', 'Filete de pescado empanizado. Acompañado de papas a la francesa y arroz.'),
  ('Niños granjeros', 'Fajitas de arrachera infantil', 'Fajitas de arrachera. Acompañadas de papas a la francesa y arroz.'),
  ('Niños granjeros', 'Caldito Granero', 'Caldo infantil con pechuga de pollo, arroz norteño, asadero y aguacate. No incluye acompañamientos adicionales.'),
  ('Niños granjeros', 'Boneless', 'Boneless de pollo. Acompañados con papas a la francesa.'),
  -- Bebidas
  ('Bebidas', 'Agua natural 500 ml', 'Botella de agua natural de 500 ml. No incluye acompañamientos adicionales.'),
  ('Bebidas', 'Refrescos 355 ml', 'Refresco de 355 ml, presentación genérica; no hay sabores ni marcas adicionales registrados.'),
  ('Bebidas', 'Limonada natural', 'Limonada natural disponible en tres presentaciones. No incluye acompañamientos adicionales.'),
  ('Bebidas', 'Limonada mineral', 'Limonada mineral disponible en tres presentaciones. No incluye acompañamientos adicionales.'),
  ('Bebidas', 'Horchata', 'Agua de horchata disponible en tres presentaciones. No incluye acompañamientos adicionales.'),
  -- Cervezas
  ('Cervezas', 'Cerveza artesanal 355 ml', 'Cerveza artesanal de 355 ml, presentación única registrada.'),
  ('Cervezas', 'Cerveza nacional 355 ml', 'Cerveza nacional de 355 ml, presentación única registrada.'),
  ('Cervezas', 'Cubetas y cerveza importada', 'Cerveza importada y paquetes de cerveza en distintas presentaciones. No incluye acompañamientos adicionales.'),
  -- Postres
  ('Postres', 'Postre del día', 'Postre del día; el tipo específico puede cambiar. No se ofrecen variedades adicionales.'),
  ('Postres', 'Tarta de manzana con nieve', 'Tarta de manzana acompañada con nieve. No incluye acompañamientos adicionales.'),
  ('Postres', 'Brownies con nieve', 'Brownie acompañado con nieve. No incluye acompañamientos adicionales.'),
  ('Postres', 'Cheesecake con nieve', 'Cheesecake acompañado con nieve. No incluye acompañamientos adicionales.')
) as v(categoria, nombre, descripcion)
join categoria_producto c on c.nombre = v.categoria
on conflict (nombre) do update set
  id_categoria = excluded.id_categoria,
  descripcion = excluded.descripcion;

-- =====================================================================
-- 3) VARIANTES (todo platillo tiene al menos una; ver nota al inicio)
-- =====================================================================
insert into variante_producto (id_platillo, nombre, precio_centavos)
select p.id_platillo, v.nombre_variante, v.precio_centavos
from (values
  ('Rajas con queso', 'Único', 12300),
  ('Guacamole', 'Único', 12300),
  ('Papas francesas', 'Único', 6900),
  ('Orden de salchichas', 'Único', 9400),
  ('Frijoles charros', 'Único', 4200),
  ('Elote amarillo', 'Único', 6000),
  ('Queso fundido', 'Natural', 11900),
  ('Queso fundido', 'Chorizo', 13400),
  ('Queso fundido', 'Champiñones', 13400),
  ('Queso fundido', 'Elote', 13400),
  ('Luiggi Especial', 'Único', 17400),
  ('Orden de chiles', 'Único', 8900),

  ('Papa Natural', 'Único', 11900),
  ('Papa con Elote', 'Único', 12400),
  ('Papa con Champiñón', 'Único', 12400),
  ('Papa con Chorizo', 'Único', 13800),
  ('Papa con Tocino', 'Único', 14800),
  ('Papa con Arrachera', 'Único', 18900),
  ('Papa Luiggi Especial', 'Único', 20400),

  ('Ensalada Granero', 'Único', 19600),
  ('Ensalada Natural', 'Único', 14800),
  ('Ensalada Rancho', 'Único', 25900),
  ('Ensalada Camarón', 'Único', 26900),

  ('Taquiza Sirloin', 'Con frijoles charros', 60900),
  ('Taquiza Sirloin', 'Con frijoles refritos', 60900),
  ('Taquiza Granero', 'Con frijoles charros', 60900),
  ('Taquiza Granero', 'Con frijoles refritos', 60900),
  ('Taquiza del Mar', 'Con frijoles charros', 62400),
  ('Taquiza del Mar', 'Con frijoles refritos', 62400),
  ('Taquiza Ranchera', 'Con frijoles charros', 62400),
  ('Taquiza Ranchera', 'Con frijoles refritos', 62400),
  ('Taquiza Alambre', 'Con frijoles charros', 55900),
  ('Taquiza Alambre', 'Con frijoles refritos', 55900),

  ('Caldo Granero', 'Único', 10900),
  ('Sartencito', 'Único', 30400),
  ('Guisado Abigeo', 'Único', 30400),
  ('Platillo Granero', 'Único', 30400),

  ('Costillas Chihuahua', 'Único', 31900),
  ('Fajitas de arrachera', 'Único', 26900),
  ('Enchiladas Las Vírgenes', 'Pollo', 18700),
  ('Enchiladas Las Vírgenes', 'Queso', 18700),
  ('Fajitas Trío', 'Único', 30500),
  ('Fajitas de pollo', 'Único', 23900),
  ('Tiras de pollo', 'Salsa Búfalo', 18600),
  ('Tiras de pollo', 'Salsa BBQ', 18600),

  ('Delicias', 'Único', 12900),
  ('Delicias Tocino', 'Único', 14400),
  ('Granero', 'Único', 14900),
  ('Pollo', 'Único', 12400),
  ('Algodoneros', 'Único', 16900),
  ('Hawaiana', 'Único', 14900),

  ('Parrillada Familiar', 'Único', 104900),
  ('Parrillada Mar y Tierra', 'Único', 123800),
  ('Parrillada 1 kg', 'Único', 69800),
  ('T-Bone 450 gr', 'Único', 40300),
  ('Arrachera 450 gr', 'Único', 45300),
  ('Arrachera al Chipotle 450 gr', 'Único', 47300),
  ('Sirloin 450 gr', 'Único', 35300),
  ('Rib Eye 450 gr', 'Único', 47300),
  ('Cowboy 450 gr', 'Único', 46900),
  ('Costillas 450 gr', 'Único', 30300),
  ('Costillas BBQ 450 gr', 'Único', 33200),
  ('Costillas a la Diabla', 'Único', 33200),

  ('La Boquilla', 'Único', 14800),
  ('Tacos Rancheros', 'Único', 15800),
  ('Villalba', 'Único', 13900),
  ('Tacos de Arrachera', 'Único', 19400),
  ('El Granero', 'Único', 15900),
  ('Taco Delicias', 'Alambre', 12400),
  ('Taco Delicias', 'Sirloin', 12400),

  ('Pizerola de Sirloin', 'Único', 16900),
  ('Pizerola de Alambre', 'Único', 16900),

  ('Filete de pescado empanizado', 'Único', 27300),
  ('Filete a la mantequilla', 'Único', 27300),
  ('Filete al ajillo', 'Único', 27300),
  ('Filete en crema de champiñones', 'Único', 27300),
  ('Filete a la diabla', 'Único', 27300),
  ('Torre de mariscos', 'Único', 32900),
  ('Caldo de pescado', 'Único', 11900),
  ('Caldo de oso', 'Único', 14900),
  ('Caldo de camarón', 'Único', 17400),
  ('Cóctel de camarón', 'Chico', 14200),
  ('Cóctel de camarón', 'Grande', 20600),
  ('Tacos capeados', 'Camarón', 24400),
  ('Tacos capeados', 'Pescado', 23400),

  ('Camarones al Ajillo', 'Único', 28300),
  ('Camarones a la Diabla', 'Único', 28300),
  ('Camarones Fiesta', 'Único', 31200),
  ('Camarones Empanizados', 'Único', 28300),
  ('Camarones a la Crema', 'Único', 28300),
  ('Camarones al Coco', 'Único', 31200),

  ('Fajitas de pollo infantil', 'Único', 12300),
  ('Filete de pescado', 'Único', 14900),
  ('Fajitas de arrachera infantil', 'Único', 15900),
  ('Caldito Granero', 'Único', 7400),
  ('Boneless', 'Único', 15400),

  ('Agua natural 500 ml', 'Único', 2300),
  ('Refrescos 355 ml', 'Único', 3900),
  ('Limonada natural', 'Vaso 500 ml', 4800),
  ('Limonada natural', 'Frasco 1 L', 7200),
  ('Limonada natural', 'Jarra 2000 ml', 13800),
  ('Limonada mineral', 'Vaso 500 ml', 4900),
  ('Limonada mineral', 'Frasco 1 L', 7400),
  ('Limonada mineral', 'Jarra 2000 ml', 15900),
  ('Horchata', 'Vaso 500 ml', 4200),
  ('Horchata', 'Frasco 1 L', 6900),
  ('Horchata', 'Jarra 2000 ml', 13300),

  ('Cerveza artesanal 355 ml', 'Único', 7900),
  ('Cerveza nacional 355 ml', 'Único', 4900),
  ('Cubetas y cerveza importada', 'Cerveza importada 355 ml', 5500),
  ('Cubetas y cerveza importada', 'Cubeta 10 importadas 1/4', 14500),
  ('Cubetas y cerveza importada', 'Cubeta 10 nacionales 1/4', 13900),
  ('Cubetas y cerveza importada', 'Cubeta 6 importadas 1/2', 26900),
  ('Cubetas y cerveza importada', 'Cubeta 6 nacionales 1/2', 25900),

  ('Postre del día', 'Único', 6900),
  ('Tarta de manzana con nieve', 'Único', 9800),
  ('Brownies con nieve', 'Único', 9800),
  ('Cheesecake con nieve', 'Único', 9800)
) as v(platillo, nombre_variante, precio_centavos)
join platillo p on p.nombre = v.platillo
on conflict (id_platillo, nombre) do update set
  precio_centavos = excluded.precio_centavos;

-- =====================================================================
-- 4) SINONIMOS
-- =====================================================================
insert into sinonimo_producto (id_platillo, frase)
select p.id_platillo, v.frase
from (values
  ('Rajas con queso', 'rajas'), ('Rajas con queso', 'rajas con queso'),
  ('Guacamole', 'guacamole'), ('Guacamole', 'guacamole con totopos'),
  ('Papas francesas', 'papas'), ('Papas francesas', 'papas fritas'), ('Papas francesas', 'papas francesas'),
  ('Orden de salchichas', 'salchichas'), ('Orden de salchichas', 'orden de salchichas'),
  ('Frijoles charros', 'frijoles'), ('Frijoles charros', 'frijoles charros'),
  ('Elote amarillo', 'elote'), ('Elote amarillo', 'elote amarillo'),
  ('Queso fundido', 'queso'), ('Queso fundido', 'queso fundido'),
  ('Luiggi Especial', 'luiggi'), ('Luiggi Especial', 'luiggi especial'), ('Luiggi Especial', 'queso con camarones'),
  ('Orden de chiles', 'chiles'), ('Orden de chiles', 'orden de chiles'),

  ('Papa Natural', 'papa natural'), ('Papa Natural', 'papa asada natural'),
  ('Papa con Elote', 'papa con elote'),
  ('Papa con Champiñón', 'papa con champiñones'), ('Papa con Champiñón', 'papa champiñón'),
  ('Papa con Chorizo', 'papa con chorizo'),
  ('Papa con Tocino', 'papa con tocino'),
  ('Papa con Arrachera', 'papa con arrachera'),
  ('Papa Luiggi Especial', 'papa luiggi'), ('Papa Luiggi Especial', 'papa especial con camarón'),

  ('Ensalada Granero', 'ensalada granero'), ('Ensalada Granero', 'ensalada con pollo'),
  ('Ensalada Natural', 'ensalada natural'),
  ('Ensalada Rancho', 'ensalada rancho'), ('Ensalada Rancho', 'ensalada con arrachera'),
  ('Ensalada Camarón', 'ensalada camarón'), ('Ensalada Camarón', 'ensalada de camarón'),

  ('Taquiza Sirloin', 'taquiza sirloin'),
  ('Taquiza Granero', 'taquiza granero'),
  ('Taquiza del Mar', 'taquiza del mar'),
  ('Taquiza Ranchera', 'taquiza ranchera'),
  ('Taquiza Alambre', 'taquiza alambre'), ('Taquiza Alambre', 'alambre'),

  ('Caldo Granero', 'caldo granero'), ('Caldo Granero', 'caldo de pollo'),
  ('Sartencito', 'sartencito'), ('Sartencito', 'sartén de sirloin'),
  ('Guisado Abigeo', 'abigeo'), ('Guisado Abigeo', 'guisado abigeo'),
  ('Platillo Granero', 'platillo granero'),

  ('Costillas Chihuahua', 'costillas chihuahua'), ('Costillas Chihuahua', 'costillas'),
  ('Fajitas de arrachera', 'fajitas de arrachera'),
  ('Enchiladas Las Vírgenes', 'enchiladas'), ('Enchiladas Las Vírgenes', 'enchiladas las vírgenes'),
  ('Fajitas Trío', 'fajitas trío'), ('Fajitas Trío', 'fajitas mixtas'),
  ('Fajitas de pollo', 'fajitas de pollo'),
  ('Tiras de pollo', 'tiras de pollo'), ('Tiras de pollo', 'pollo empanizado'),

  ('Delicias', 'hamburguesa delicias'), ('Delicias', 'delicias'),
  ('Delicias Tocino', 'delicias tocino'), ('Delicias Tocino', 'hamburguesa con tocino'),
  ('Granero', 'hamburguesa granero'), ('Granero', 'granero'),
  ('Pollo', 'hamburguesa de pollo'),
  ('Algodoneros', 'algodoneros'), ('Algodoneros', 'hamburguesa doble'),
  ('Hawaiana', 'hawaiana'), ('Hawaiana', 'hamburguesa hawaiana'),

  ('Parrillada Familiar', 'parrillada familiar'),
  ('Parrillada Mar y Tierra', 'parrillada mar y tierra'), ('Parrillada Mar y Tierra', 'mar y tierra'),
  ('Parrillada 1 kg', 'parrillada un kilo'), ('Parrillada 1 kg', 'parrillada 1 kg'),
  ('T-Bone 450 gr', 't-bone'), ('T-Bone 450 gr', 't bone'),
  ('Arrachera 450 gr', 'arrachera'),
  ('Arrachera al Chipotle 450 gr', 'arrachera chipotle'),
  ('Sirloin 450 gr', 'sirloin'),
  ('Rib Eye 450 gr', 'rib eye'), ('Rib Eye 450 gr', 'ribeye'),
  ('Cowboy 450 gr', 'cowboy'),
  ('Costillas 450 gr', 'costillas 450'),
  ('Costillas BBQ 450 gr', 'costillas bbq'),
  ('Costillas a la Diabla', 'costillas diabla'), ('Costillas a la Diabla', 'costillas a la diabla'),

  ('La Boquilla', 'la boquilla'), ('La Boquilla', 'tacos boquilla'),
  ('Tacos Rancheros', 'tacos rancheros'),
  ('Villalba', 'villalba'), ('Villalba', 'tacos villalba'),
  ('Tacos de Arrachera', 'tacos de arrachera'),
  ('El Granero', 'tacos granero'), ('El Granero', 'el granero'),
  ('Taco Delicias', 'taco delicias'),

  ('Pizerola de Sirloin', 'pizerola sirloin'), ('Pizerola de Sirloin', 'pizza de sirloin'),
  ('Pizerola de Alambre', 'pizerola alambre'),

  ('Filete de pescado empanizado', 'filete empanizado'), ('Filete de pescado empanizado', 'pescado empanizado'),
  ('Filete a la mantequilla', 'filete mantequilla'),
  ('Filete al ajillo', 'filete al ajillo'),
  ('Filete en crema de champiñones', 'filete champiñones'),
  ('Filete a la diabla', 'filete diabla'),
  ('Torre de mariscos', 'torre de mariscos'),
  ('Caldo de pescado', 'caldo pescado'),
  ('Caldo de oso', 'caldo de oso'),
  ('Caldo de camarón', 'caldo camarón'),
  ('Cóctel de camarón', 'coctel'), ('Cóctel de camarón', 'cóctel de camarón'),
  ('Tacos capeados', 'tacos capeados'),

  ('Camarones al Ajillo', 'camarones al ajillo'),
  ('Camarones a la Diabla', 'camarones diabla'),
  ('Camarones Fiesta', 'camarones fiesta'),
  ('Camarones Empanizados', 'camarones empanizados'),
  ('Camarones a la Crema', 'camarones crema'),
  ('Camarones al Coco', 'camarones coco'),

  ('Fajitas de pollo infantil', 'fajitas niño'), ('Fajitas de pollo infantil', 'fajitas de pollo infantil'),
  ('Filete de pescado', 'filete niño'), ('Filete de pescado', 'pescado infantil'),
  ('Fajitas de arrachera infantil', 'fajitas arrachera niño'),
  ('Caldito Granero', 'caldito granero'), ('Caldito Granero', 'caldo niño'),
  ('Boneless', 'boneless'),

  ('Agua natural 500 ml', 'agua'), ('Agua natural 500 ml', 'agua natural'),
  ('Refrescos 355 ml', 'refresco'), ('Refrescos 355 ml', 'soda'),
  ('Limonada natural', 'limonada natural'),
  ('Limonada mineral', 'limonada mineral'),
  ('Horchata', 'horchata'), ('Horchata', 'agua de horchata'),

  ('Cerveza artesanal 355 ml', 'cerveza artesanal'),
  ('Cerveza nacional 355 ml', 'cerveza nacional'),
  ('Cubetas y cerveza importada', 'cerveza importada'), ('Cubetas y cerveza importada', 'cubeta'),

  ('Postre del día', 'postre'), ('Postre del día', 'postre del día'),
  ('Tarta de manzana con nieve', 'tarta de manzana'),
  ('Brownies con nieve', 'brownie'), ('Brownies con nieve', 'brownies con nieve'),
  ('Cheesecake con nieve', 'cheesecake')
) as v(platillo, frase)
join platillo p on p.nombre = v.platillo
on conflict (id_platillo, frase) do nothing;

-- =====================================================================
-- 5) EXTRAS
-- =====================================================================
insert into extra (nombre, precio_centavos, descripcion) values
  ('Totopos', 2000, 'Porción extra de totopos.'),
  ('BBQ', 1500, 'Porción extra de salsa BBQ.'),
  ('Aguacate', 2500, 'Porción extra de aguacate.'),
  ('Toreados', 2100, 'Porción extra de chiles toreados.'),
  ('Espuelas (camarones)', 5500, 'Cargo adicional por camarones, disponible únicamente en los cortes que lo permiten (T-Bone, Arrachera, Arrachera al Chipotle, Sirloin y Rib Eye), validado mediante la tabla platillo_extra.')
on conflict (nombre) do update set
  precio_centavos = excluded.precio_centavos,
  descripcion = excluded.descripcion;