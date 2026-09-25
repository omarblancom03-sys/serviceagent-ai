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

-- Registra un PIN incorrecto en un solo UPDATE atómico. Si la API leyera el contador, le sumara 1
-- y lo guardara, varias peticiones al mismo tiempo leerían el mismo valor y el bloqueo nunca
-- llegaría. Al llegar a p_max_intentos bloquea p_minutos_bloqueo minutos y reinicia el contador.
-- Si el empleado ya está bloqueado no cuenta nada y devuelve su estado actual.
-- Las reglas (5 intentos, 15 min) viven en apps/api/src/services/sesion.ts y llegan como parámetros.
-- Devuelve cero filas solo si el empleado no existe.
create function public.registrar_intento_fallido(
  p_empleado_id uuid,
  p_max_intentos integer,
  p_minutos_bloqueo integer,
  p_ahora timestamptz default now()
)
returns table (intentos_fallidos integer, bloqueado_hasta timestamptz)
language sql
set search_path = ''
as $$
  with actualizado as (
    update public.empleados e set
      intentos_fallidos = case
        when e.intentos_fallidos + 1 >= p_max_intentos then 0
        else e.intentos_fallidos + 1
      end,
      bloqueado_hasta = case
        when e.intentos_fallidos + 1 >= p_max_intentos
          then p_ahora + make_interval(mins => p_minutos_bloqueo)
        else null
      end
    where e.id = p_empleado_id
      and (e.bloqueado_hasta is null or e.bloqueado_hasta <= p_ahora)
    returning e.intentos_fallidos, e.bloqueado_hasta
  )
  select a.intentos_fallidos, a.bloqueado_hasta from actualizado a
  union all
  -- Ya estaba bloqueado: el UPDATE no tocó la fila y se devuelve tal como está.
  select e.intentos_fallidos, e.bloqueado_hasta from public.empleados e
  where e.id = p_empleado_id and not exists (select 1 from actualizado);
$$;

-- Postgres deja ejecutar funciones a PUBLIC por defecto: se quita y solo la API puede llamarla.
revoke execute on function public.registrar_intento_fallido(uuid, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.registrar_intento_fallido(uuid, integer, integer, timestamptz)
  to service_role;
