# packages/shared — Esquemas y tipos compartidos

## Qué es

Paquete `@serviceagent/shared`: esquemas zod, tipos y constantes que usan la API y los frontends. Es la única definición de cada contrato; nadie redefine un esquema en su app.

## Cómo está organizado

- `src/index.ts`: reexporta todo (`export * from './<archivo>'`). Es la única entrada del paquete.
- `src/health.ts`: `HealthResponseSchema` y `HealthResponse`, la respuesta de `GET /health`.
- `src/auth.ts`: roles, PIN, login, sesión, errores de autenticación y `TokenPayloadSchema` (estricto: solo `sub`, `rol`, `exp`).
- Esquemas del menú: pendiente: se define en US-03-P1.

Se consume como **código TypeScript fuente, sin paso de build** (D9): `package.json` apunta `exports` a `./src/index.ts` y Vite y Wrangler lo compilan.

## Convenciones de esta área

- Un archivo por recurso (`menu.ts`, `pedido.ts`…), reexportado desde `index.ts`.
- Por cada contrato: `XSchema` (zod) + `type X = z.infer<typeof XSchema>`. El tipo se deriva del esquema, no se escribe a mano.
- Montos en centavos con `z.number().int()`.
- Solo esquemas, tipos y constantes: nada de lógica de negocio ni llamadas a red.
- Sin dependencias de Hono, React ni Supabase: solo `zod`.

## Cómo probar

```bash
pnpm --filter @serviceagent/shared typecheck
```

Los esquemas se prueban desde quien los usa (por ejemplo, `apps/api/test/health.test.ts` valida la respuesta con `HealthResponseSchema.parse`). Tests propios del paquete: pendiente: se define en US-03-P1.

## Reglas que aplican

- [Reglas de oro](../../CLAUDE.md#reglas-de-oro) del raíz (zod para toda entrada externa, centavos).
- [docs/negocio.md](../../docs/negocio.md): estados y reglas que los esquemas deben reflejar.
- [docs/decisiones.md](../../docs/decisiones.md): D7, D9.
