# apps/api — API (Hono sobre Cloudflare Workers)

## Qué es

API del sistema: la usan el agente de Retell (custom functions), los frontends y los simuladores. Corre como el Worker `serviceagent-api` con Hono + `@hono/zod-openapi`, que genera Swagger a partir de los esquemas zod.

## Cómo está organizado

| Ruta                  | Qué hay                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`        | Crea `app` (`OpenAPIHono`), registra las rutas, publica `/openapi.json` y Swagger UI en `/docs`. Exporta `app` (con nombre, para tests) y por defecto (para el Worker). |
| `src/routes/`         | Un archivo por recurso. Cada uno exporta `registrarX(app)`. Hoy: `health.ts` (`GET /health`).                      |
| `src/services/`       | Lógica de negocio sin HTTP. Pendiente: se define en US-03-P2 (primer servicio: menú).                              |
| `src/lib/`            | Clientes e infraestructura. Pendiente: Supabase en US-03-P2, auth por PIN en US-04, firma de Retell en US-06, límites de uso en US-19, notificador de WhatsApp en US-28. |
| `test/`               | Tests de Vitest (`*.test.ts`).                                                                                     |
| `wrangler.jsonc`      | Configuración del Worker (puerto local 8787, `nodejs_compat`).                                                     |

## Convenciones de esta área

- Cada endpoint se define con `createRoute` y esquemas de `@serviceagent/shared`: así queda validado y documentado en Swagger sin trabajo extra.
- La ruta solo traduce HTTP (leer entrada, llamar al servicio, responder); la lógica va en `src/services/`.
- La versión que reportan `/health` y Swagger sale de `package.json`.
- `vars` de `wrangler.jsonc` es solo para valores públicos; secretos en `.dev.vars` (local) o `wrangler secret put` (producción).

## Cómo probar

```bash
pnpm --filter @serviceagent/api test        # Vitest
pnpm --filter @serviceagent/api dev         # http://localhost:8787/health y /docs
pnpm --filter @serviceagent/api typecheck
pnpm --filter @serviceagent/api build       # wrangler deploy --dry-run
```

Los tests llaman a la app con `app.request('/ruta')`, sin levantar el Worker (decisión D8). Cada endpoint nuevo lleva su test y un test de que aparece en `/openapi.json`.

## Reglas que aplican

- [Reglas de oro](../../CLAUDE.md#reglas-de-oro) del raíz (dinero en backend, centavos, zod, `services/`, secretos).
- [docs/negocio.md](../../docs/negocio.md): estados del pedido, pagos, inventario, tiempo estimado, auth y roles.
- [docs/agente.md](../../docs/agente.md): endpoints de las custom functions y verificación de `X-Retell-Signature`.
- [docs/despliegue.md](../../docs/despliegue.md): secretos del Worker y despliegue.
- [docs/decisiones.md](../../docs/decisiones.md): D2, D7, D8, D9.
