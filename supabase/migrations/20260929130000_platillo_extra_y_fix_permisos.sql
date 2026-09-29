-- US-02-P1: relacion platillo <-> extra, y correccion de un permiso faltante
-- de la migracion anterior.
--
-- A) Bug encontrado en 20260929120000_cerrar_lectura_publica_menu.sql: el
--    revoke all quito TODOS los permisos de sinonimo_producto (incluido
--    service_role) pero el grant select nunca se lo devolvio. Sin este
--    fix, la API no puede leer esa tabla. Se corrige aqui en vez de editar
--    la migracion ya aplicada, porque las migraciones existentes no se
--    tocan (regla del equipo: toda correccion va en una migracion nueva).
grant select on table public.sinonimo_producto to service_role;

-- B) Tabla platillo_extra: falta en el esquema una forma de saber que
--    extras aplican a que platillo. Ejemplo real del menu: "con espuelas"
--    (+$55) solo aplica a T-Bone, Arrachera, Arrachera al Chipotle, Sirloin
--    y Rib Eye (450 gr) -- no a cualquier platillo. Sin esta tabla el
--    backend no puede validar que un extra pedido sea valido para ese
--    platillo, lo que rompe la regla "el dinero lo calcula el backend"
--    (CLAUDE.md #1): no se puede cobrar ni rechazar algo que no se puede
--    validar.
create table if not exists platillo_extra (
  id_platillo integer not null references platillo (id_platillo) on delete cascade,
  id_extra integer not null references extra (id_extra) on delete cascade,
  primary key (id_platillo, id_extra)
);

comment on table platillo_extra is
  'Que extras (con precio) se pueden agregar a cada platillo. Ej.: espuelas solo en ciertos cortes.';

-- Mismo patron de seguridad que el resto del esquema del menu (D15):
-- RLS activo, sin policies, y GRANT minimo de solo lectura a service_role.
-- Los permisos de escritura (administracion del menu) se agregan en su
-- propia historia, igual que en las demas tablas del menu.
alter table platillo_extra enable row level security;

revoke all on table platillo_extra from anon, authenticated, service_role;
grant select on table platillo_extra to service_role;
