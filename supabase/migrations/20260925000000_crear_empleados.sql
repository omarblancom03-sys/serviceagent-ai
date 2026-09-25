-- US-04: empleados que entran por PIN (docs/negocio.md → Autenticación y roles).

create table public.empleados (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(trim(nombre)) > 0),
  rol text not null check (rol in ('cocina', 'caja', 'admin')),
  -- Hash PBKDF2 del PIN (apps/api/src/lib/pin.ts, decisión D13). Nunca el PIN en texto plano.
  pin_hash text not null check (pin_hash like 'pbkdf2\_sha256$%'),
  activo boolean not null default true,
  -- Bloqueo temporal: 5 intentos fallidos seguidos → bloqueado_hasta = ahora + 15 min.
  intentos_fallidos integer not null default 0 check (intentos_fallidos >= 0),
  bloqueado_hasta timestamptz,
  creado_en timestamptz not null default now()
);

comment on table public.empleados is 'Empleados con acceso por PIN. Solo la API la lee y escribe.';

-- Permisos explícitos: el proyecto no expone tablas nuevas automáticamente (supabase/CLAUDE.md).
-- Solo la API, con la llave secreta (rol service_role), lee la tabla y actualiza el bloqueo.
-- Primero se quita todo (por si el proyecto da permisos por defecto) y luego se concede lo mínimo.
-- anon y authenticated no tienen ningún permiso. Los empleados se crean desde el seed.
revoke all on table public.empleados from anon, authenticated, service_role;
grant select on table public.empleados to service_role;
grant update (intentos_fallidos, bloqueado_hasta) on table public.empleados to service_role;

-- RLS activo y sin políticas: segunda barrera si algún día alguien concede permisos a anon.
-- service_role tiene BYPASSRLS; los permisos por rol de la app viven en la API (D12).
alter table public.empleados enable row level security;
