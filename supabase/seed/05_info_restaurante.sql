-- Seed de info_restaurante (US-17, D62)
--
-- Información del restaurante y preguntas frecuentes que responde el agente con
-- `info_restaurante`. Textos aprobados por el PO el 10 de noviembre de 2026:
-- horario, dirección, teléfono y estacionamiento son los de El Granero; las
-- formas de pago y cómo se reserva o se pide el wifi son simulados. El agente
-- responde solo con estos textos: lo que no está aquí, dice que no lo sabe.
--
-- Una fila por tema. ON CONFLICT (tema) DO UPDATE: seguro de correr más de una
-- vez y, si cambia un texto, lo actualiza (la API reindexa ese embedding en la
-- siguiente consulta). Cada corrida vuelve a poner activo = true: para quitar un
-- tema sin borrarlo, se pone activo = false y además se quita de este seed.

insert into public.info_restaurante (tema, titulo, contenido) values
  ('horario', 'Horario',
   'Abrimos de lunes a sábado de 8:00 a. m. a 10:00 p. m. y los domingos de 8:00 a. m. a 7:00 p. m.'),
  ('direccion', 'Dirección, ubicación y cómo llegar',
   'Estamos en Avenida Río San Pedro 1227, colonia Granjas, C. P. 33077, Delicias, Chihuahua, México, en contraesquina del salón de eventos TEX-MEX.'),
  ('telefono', 'Teléfono',
   'Nuestro teléfono es 639 474 8888.'),
  ('estacionamiento', 'Estacionamiento',
   'Tenemos estacionamiento propio para 50 vehículos.'),
  ('formas_pago', 'Formas de pago',
   'En caja aceptamos efectivo y tarjeta de débito o crédito.'),
  ('alergenos', 'Alérgenos, alergias e intolerancias',
   'No podemos garantizar que un platillo esté libre de algún alérgeno, porque en la cocina se manejan muchos ingredientes. Si tienes una alergia, confírmalo con nuestro personal antes de pedir.'),
  ('reservaciones', 'Reservaciones',
   'Sí hacemos reservaciones. Para reservar, llama al 639 474 8888.'),
  ('wifi', 'Wifi',
   'Sí tenemos wifi para nuestros clientes. La contraseña te la da nuestro personal en el restaurante.')
on conflict (tema) do update
  set titulo = excluded.titulo,
      contenido = excluded.contenido,
      activo = true;
