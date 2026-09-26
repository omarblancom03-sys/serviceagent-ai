# apps/api — API (Hono sobre Cloudflare Workers)

## Qué es

API del sistema: la usan el agente de Retell (custom functions), los frontends y los simuladores. Corre como el Worker `serviceagent-api` con Hono + `@hono/zod-openapi`, que genera Swagger a partir de los esquemas zod.

## Cómo está organizado

| Ruta                     | Qué hay                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`           | `crearApp(dependencias)`: CORS (`CORS_ORIGINS`), rutas, `/openapi.json` y Swagger en `/docs`. Exporta `app` (tests) y por defecto (Worker). |
| `src/routes/`            | Un archivo por recurso; cada uno exporta `registrarX(app, deps)`. Hoy: `health.ts`, `auth.ts` (`/auth/empleados`, `/auth/login`, `/auth/sesion`). |
| `src/services/`          | Lógica de negocio sin HTTP. Hoy: `sesion.ts` (login por PIN y bloqueo). Define las interfaces de datos que usa (`EmpleadosRepo`). |
| `src/lib/env.ts`         | Tipos de las variables de entorno (`Bindings`) y del contexto (`AppEnv`).                                                |
| `src/lib/auth.ts`        | JWT propio (HS256, `JWT_SECRET`) y middleware `requiereRol(...)`.                                                        |
| `src/lib/pin.ts`         | Hash y verificación del PIN (HMAC con `PIN_PEPPER` + PBKDF2, D13).                                                       |
| `src/lib/supabase.ts`    | `crearClienteSupabase(env)`: cliente con la llave de servicio, uno por petición. Lo reutilizan todas las historias.      |
| `src/lib/repo*.ts`       | Implementación sobre Supabase de las interfaces de `services/`. Hoy: `repoEmpleados.ts`.                                 |
| `scripts/hashPin.ts`     | `pnpm --filter @serviceagent/api hash-pin <PIN>`: hash para el seed (lee `PIN_PEPPER` de `.dev.vars`).                                                   |
| `test/`                  | Tests de Vitest (`*.test.ts`) y `repoEnMemoria.ts` (datos falsos para tests).                                            |

Pendiente en `src/lib/`: firma de Retell en US-06, límites de uso en US-19, notificador de WhatsApp en US-28.

## Convenciones de esta área

- Cada endpoint se define con `createRoute` y esquemas de `@serviceagent/shared`: así queda validado y documentado en Swagger.
- La ruta solo traduce HTTP; la lógica va en `src/services/`, que recibe sus datos por interfaz (repo) para probarse sin base.
- **Todo endpoint interno lleva `middleware: [requiereRol(...)]` y `security: [{ Bearer: [] }]`.** `admin` siempre pasa. Endpoints que cambian precios o recetas: solo `requiereRol('admin')`.
- La ruta lee la sesión con `c.get('sesion')` (`sub`, `rol`, `exp`); nunca confía en datos del cuerpo para saber quién es el empleado.
- Las filas de Supabase se validan con zod al leerlas (no hay tipos generados todavía).
- Datos que varias peticiones cambian a la vez se actualizan con una función SQL vía `rpc()`, nunca con leer-calcular-guardar (D14). Ejemplo: `registrarIntentoFallido` en `repoEmpleados.ts`.
- `vars` de `wrangler.jsonc` es solo para valores públicos; secretos en `.dev.vars` (local) o `wrangler secret put` (producción).

## Cómo probar

```bash
pnpm --filter @serviceagent/api test        # Vitest
pnpm --filter @serviceagent/api dev         # http://localhost:8787/health y /docs (necesita apps/api/.dev.vars)
pnpm --filter @serviceagent/api typecheck
pnpm --filter @serviceagent/api build       # wrangler deploy --dry-run
```

Los tests usan `crearApp({ ... })` con repos en memoria y `app.request(ruta, init, env)`, sin levantar el Worker (D8). Cada endpoint nuevo lleva su test, uno de permisos (401/403) si es interno y uno de que aparece en `/openapi.json`.

## Reglas que aplican

- [Reglas de oro](../../CLAUDE.md#reglas-de-oro) del raíz (dinero en backend, centavos, zod, `services/`, secretos).
- [docs/negocio.md](../../docs/negocio.md): estados del pedido, pagos, inventario, tiempo estimado, auth y roles.
- [docs/agente.md](../../docs/agente.md): endpoints de las custom functions y verificación de `X-Retell-Signature`.
- [docs/despliegue.md](../../docs/despliegue.md): secretos del Worker (`JWT_SECRET`, `PIN_PEPPER`, `SUPABASE_*`) y despliegue.
- [docs/decisiones.md](../../docs/decisiones.md): D2, D7, D8, D9, D12, D13, D14.
