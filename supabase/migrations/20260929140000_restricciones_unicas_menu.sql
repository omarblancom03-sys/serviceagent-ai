-- US-02-P2: restricciones unicas para que el seed sea idempotente.
-- Sin esto, correr el seed dos veces duplica el menu completo.

alter table categoria_producto
  add constraint categoria_producto_nombre_key unique (nombre);

alter table platillo
  add constraint platillo_nombre_key unique (nombre);

alter table variante_producto
  add constraint variante_producto_id_platillo_nombre_key unique (id_platillo, nombre);

alter table extra
  add constraint extra_nombre_key unique (nombre);

-- sinonimo_producto e ingrediente_removible ya tenian su indice unico
-- (id_platillo, frase) y (id_platillo, nombre) desde la migracion original;
-- no necesitan nada nuevo aqui.

-- El comentario original de tiempo_estimado_min (migracion 20260929100000,
-- ya en main) decia que quedaba en NULL "pendiente de definir". Ya no es
-- cierto; "comment on" lo reemplaza sin editar esa migracion.
comment on column platillo.tiempo_estimado_min is
  'Minutos de preparacion base, fijos por categoria (D18). Los llena el seed 03_tiempos_preparacion_menu.sql; datos simulados.';
