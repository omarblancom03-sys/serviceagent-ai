-- D15: Supabase solo se accede desde la API con la llave de servicio.
-- La migracion del menu (20260929100000) dejo las tablas legibles con la anon
-- key mediante policies de lectura publica. Aqui se quitan esas policies y se
-- dejan los permisos como en el resto del esquema: nada para anon ni
-- authenticated, y solo lectura para service_role (la API).
-- Las escrituras (administracion del menu) se conceden en su propia historia.

drop policy if exists "lectura publica" on public.categoria_producto;
drop policy if exists "lectura publica" on public.platillo;
drop policy if exists "lectura publica" on public.variante_producto;
drop policy if exists "lectura publica" on public.sinonimo_producto;
drop policy if exists "lectura publica" on public.extra;
drop policy if exists "lectura publica" on public.ingrediente_removible;

revoke all on table public.categoria_producto from anon, authenticated, service_role;
revoke all on table public.platillo from anon, authenticated, service_role;
revoke all on table public.variante_producto from anon, authenticated, service_role;
revoke all on table public.sinonimo_producto from anon, authenticated, service_role;
revoke all on table public.extra from anon, authenticated, service_role;
revoke all on table public.ingrediente_removible from anon, authenticated, service_role;

grant select on table public.categoria_producto to service_role;
grant select on table public.platillo to service_role;
grant select on table public.variante_producto to service_role;
grant select on table public.sinonimo_producto to service_role;
grant select on table public.extra to service_role;
grant select on table public.ingrediente_removible to service_role;

-- RLS sigue activo (lo activo la migracion anterior) y ahora sin policies:
-- segunda barrera si algun dia alguien concede permisos a anon.
