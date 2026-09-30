-- US-02-P2: restricciones unicas para que el seed sea idempotente.
Sin esto, correr el seed dos veces duplica el menu completo.

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