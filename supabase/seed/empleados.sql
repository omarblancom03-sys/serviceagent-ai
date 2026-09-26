-- Empleados de prueba, uno por rol. SOLO DESARROLLO: sus PIN están en supabase/CLAUDE.md.
-- Hashes generados con: pnpm --filter @serviceagent/api hash-pin <PIN>
-- Usan el PIN_PEPPER de DESARROLLO (docs/despliegue.md): con otro pepper estos PIN no entran.
-- Se puede correr varias veces: deja a cada empleado activo y sin bloqueo.

insert into public.empleados (id, nombre, rol, pin_hash) values
  ('4620f689-a503-44c9-9167-75c183f08ef7', 'Cocina de prueba', 'cocina',
   'pbkdf2_sha256$2000$8/YSUFKWLIGwdaukt3U5HA==$8AE7DvDuv0RETbPYWFOjub3kO3R3lMkoXFVJopiR+88='),
  ('77b9bf63-5f4a-4509-823d-3a7de04edb82', 'Caja de prueba', 'caja',
   'pbkdf2_sha256$2000$MT5HQXCXWdj1fBUuEzlwEA==$joBrEfq42ydmYoa3JgyRuC+18oR2HLlBtEhOks6JpBY='),
  ('41c0448e-303f-4d09-9636-d9950556428a', 'Admin de prueba', 'admin',
   'pbkdf2_sha256$2000$bKYW/Knr3L+SeIrm62+Lgg==$kgg7jLzHly11JDEZ6Sd9KtihEyfR7IPCIS2um44LgCA=')
on conflict (id) do update set
  nombre = excluded.nombre,
  rol = excluded.rol,
  pin_hash = excluded.pin_hash,
  activo = true,
  intentos_fallidos = 0,
  bloqueado_hasta = null;
