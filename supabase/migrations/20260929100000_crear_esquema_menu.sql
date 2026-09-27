-- Esquema del menu (US-02-P1), basado en el diagrama ER de El Granero,
-- bloque MENU unicamente (categoria_producto, platillo, variante_producto,
-- sinonimo_producto, extra). Las demas tablas del diagrama (conversacion,
-- mensajes, direccion, pedido, detalle_pedido, detalle_extra, metodo_pago,
-- estado_pedido, clientes_vetados, mesa, tipo_consumo) NO son parte de
-- US-02; se crean en la historia del flujo de pedidos, y su alcance
-- (WhatsApp / domicilio) debe confirmarse contra CLAUDE.md antes de eso.
--
-- Ajustes respecto al diagrama original:
--   1) precios en INTEGER (centavos), no DECIMAL(10,2) -> CLAUDE.md #5.1,
--      regla de negocio no negociable.
--   2) se agrega ingrediente_removible: la pide el criterio de aceptacion
--      de US-02-P1 y no esta en el diagrama.

create table if not exists categoria_producto (
  id_categoria integer generated always as identity primary key,
  nombre text not null,
  descripcion text,
  activo boolean not null default true
);

create table if not exists platillo (
  id_platillo integer generated always as identity primary key,
  id_categoria integer not null references categoria_producto (id_categoria) on delete restrict,
  nombre text not null,
  descripcion text not null default '',
  imagen text,
  tiempo_estimado_min integer,
  activo boolean not null default true
);

comment on column platillo.tiempo_estimado_min is
  'Minutos de preparacion base. Pendiente de definir (no viene en el menu fuente); queda NULL hasta entonces.';

create index if not exists platillo_id_categoria_idx on platillo (id_categoria);

create table if not exists variante_producto (
  id_variante integer generated always as identity primary key,
  id_platillo integer not null references platillo (id_platillo) on delete cascade,
  nombre text not null,
  precio_centavos integer not null check (precio_centavos >= 0),
  descripcion text,
  activo boolean not null default true
);

comment on column variante_producto.precio_centavos is
  'Precio total de esta variante, en centavos. Todo platillo tiene al menos una variante (aunque sea "Unico"), porque platillo no guarda precio propio.';

create index if not exists variante_producto_id_platillo_idx on variante_producto (id_platillo);

create table if not exists sinonimo_producto (
  id_sinonimo integer generated always as identity primary key,
  id_platillo integer not null references platillo (id_platillo) on delete cascade,
  frase text not null,
  activo boolean not null default true
);

create unique index if not exists sinonimo_producto_unico on sinonimo_producto (id_platillo, frase);

create table if not exists extra (
  id_extra integer generated always as identity primary key,
  nombre text not null,
  precio_centavos integer not null check (precio_centavos >= 0),
  descripcion text,
  activo boolean not null default true
);

-- Agregada respecto al diagrama: ingredientes que el cliente puede pedir
-- quitar (las "modificaciones" de la historia US-02). No es la
-- receta/inventario de CLAUDE.md #5.4 (esa es de la historia de inventario,
-- v8); aqui no hay relacion con existencias, solo lo que se puede excluir
-- sin cambio de precio.
create table if not exists ingrediente_removible (
  id_ingrediente_removible integer generated always as identity primary key,
  id_platillo integer not null references platillo (id_platillo) on delete cascade,
  nombre text not null,
  activo boolean not null default true
);

create unique index if not exists ingrediente_removible_unico
  on ingrediente_removible (id_platillo, nombre);

-- RLS: el menu es de lectura publica (el agente y las pantallas lo consultan
-- con la anon key). Las escrituras las hace el backend con la service role
-- key, que ignora RLS, asi que no se necesitan policies de escritura aqui.
alter table categoria_producto enable row level security;
alter table platillo enable row level security;
alter table variante_producto enable row level security;
alter table sinonimo_producto enable row level security;
alter table extra enable row level security;
alter table ingrediente_removible enable row level security;

create policy "lectura publica" on categoria_producto for select using (true);
create policy "lectura publica" on platillo for select using (true);
create policy "lectura publica" on variante_producto for select using (true);
create policy "lectura publica" on sinonimo_producto for select using (true);
create policy "lectura publica" on extra for select using (true);
create policy "lectura publica" on ingrediente_removible for select using (true);