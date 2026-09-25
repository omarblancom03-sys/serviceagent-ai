# supabase/ — Base de datos

## Qué es

Esquema y datos de la base de datos del proyecto (Supabase / PostgreSQL). Aquí vive todo lo que define tablas, índices, funciones, RLS y datos iniciales. En desarrollo usamos un **proyecto de Supabase en la nube**, sin Docker.

## Cómo está organizado

- `migrations/`: migraciones SQL versionadas. Hoy: `*_crear_empleados.sql` (US-04): tabla `empleados` y función `registrar_intento_fallido` (contador atómico de PIN incorrectos, D14).
- `seed/`: datos de desarrollo y demostración. Hoy: `empleados.sql` (un empleado por rol). El menú real se define en US-02-P2.
- `config.toml`: configuración del CLI. Hoy solo declara el seed (`[db.seed] sql_paths`); el resto y `pnpm db:reset` se definen en US-02-P1.

### Empleados de prueba (SOLO DESARROLLO)

| Empleado         | Rol      | PIN    |
| ---------------- | -------- | ------ |
| Cocina de prueba | `cocina` | `1111` |
| Caja de prueba   | `caja`   | `2222` |
| Admin de prueba  | `admin`  | `3333` |

Estos PIN son públicos: **nunca** se usa este seed en un ambiente real. Los hashes se generan con el `PIN_PEPPER` de desarrollo ([docs/despliegue.md](../docs/despliegue.md#pin_pepper-hash-de-los-pin)); para crear otro: `pnpm --filter @serviceagent/api hash-pin <PIN>` (lee el pepper de `apps/api/.dev.vars`).

## Convenciones de esta área

- Cada cambio al esquema entra como un archivo nuevo con prefijo de fecha (`20261001120000_crear_productos.sql`). Se puede crear con `supabase migration new <nombre>`.
- **Nunca** se edita una migración que ya llegó a `main`: se crea otra.
- Tablas y columnas en `snake_case`, en español y sin acentos (`pedidos`, `modo_envio_cocina`). Montos en centavos (`integer`).
- **Permisos explícitos en toda tabla nueva.** El proyecto tiene desactivado "Automatically expose new tables", así que una tabla sin GRANT no se puede usar (error `42501`). Cada migración que crea una tabla incluye, en este orden:
  1. `revoke all on table public.<tabla> from anon, authenticated, service_role;`
  2. `grant` solo lo que la API necesita a `service_role` (el rol de la llave secreta), por columna si aplica. Ejemplo: `grant select on table public.empleados to service_role;`
  3. Ningún permiso para `anon` ni `authenticated`: los frontends nunca leen tablas directo, piden a la API (D12).
- **Funciones:** `set search_path = ''` y nombres con esquema (`public.tabla`). Postgres deja ejecutar funciones a `PUBLIC` por defecto, así que cada una lleva `revoke execute ... from public, anon, authenticated;` y `grant execute ... to service_role;`.
- **RLS activo en toda tabla nueva** (el proyecto también lo activa solo). Sin políticas: `service_role` tiene `BYPASSRLS` y los permisos por rol viven en la API.
- El seed se puede correr varias veces (`on conflict ... do update`). Los datos simulados se marcan como tales.
- El descuento y la reposición de inventario ocurren dentro de una transacción.

## Cómo probar

Comandos del CLI que **no necesitan Docker** (se corren desde la raíz del repo con `pnpm dlx supabase`, sin instalar nada):

```bash
pnpm dlx supabase login                                  # una vez: abre el navegador
pnpm dlx supabase link --project-ref <ref-del-proyecto>  # una vez: pide la contraseña de la base
pnpm dlx supabase db push --dry-run --include-seed       # ver qué se aplicaría
pnpm dlx supabase db push --include-seed                 # aplicar migraciones pendientes + seed
```

- `db push` aplica solo las migraciones que faltan y lleva el registro en la base. `--include-seed` además corre los archivos de `seed/` declarados en `config.toml`.
- `supabase db reset --linked` **borra todo** en el proyecto remoto y lo recrea: solo en el proyecto de desarrollo y avisando al equipo.
- Necesitan Docker, y **no** los usamos: `supabase start`, `db pull`, `db diff`.
- Verificar: en el dashboard (Table Editor) debe verse `empleados` con 3 filas, y `POST /auth/login` con los PIN de arriba debe responder 200.

## Reglas que aplican

- [docs/negocio.md](../docs/negocio.md): autenticación, estados del pedido con su hora, pagos, inventario y recetas.
- [docs/decisiones.md](../docs/decisiones.md): D2, D3, D7, D12, D13 y pendiente de embeddings (US-16).
- [docs/despliegue.md](../docs/despliegue.md): variables `SUPABASE_*`; la llave de servicio solo en la API.
