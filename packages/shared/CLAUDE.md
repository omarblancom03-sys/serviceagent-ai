# packages/shared — Esquemas y tipos compartidos

## Qué es

Paquete `@serviceagent/shared`: esquemas zod, tipos y constantes que usan la API y los frontends. Es la única definición de cada contrato; nadie redefine un esquema en su app.

## Cómo está organizado

- `src/index.ts`: reexporta todo (`export * from './<archivo>'`). Es la única entrada del paquete.
- `src/health.ts`: `HealthResponseSchema` y `HealthResponse`, la respuesta de `GET /health`.
- `src/auth.ts`: roles, PIN, login, sesión, errores de autenticación, `TokenPayloadSchema` (estricto: solo `sub`, `rol`, `exp`) y `SesionActualSchema` (respuesta de `GET /auth/sesion`: `{ empleado, exp }`).
- `src/menu.ts`: contrato del menú público. `CategoriaSchema`, `VarianteSchema` (con el precio), `PlatilloSchema` (al menos una variante, sus `extrasPermitidos` e `ingredientesRemovibles`; `tiempoEstimadoMin` puede ser `null`), `IngredienteRemovibleSchema`, `ExtraSchema` (extras sueltos), `CategoriaMenuSchema`, `RespuestaMenuSchema` (`GET /menu`), `ParamsProductoSchema` (solo dígitos, hasta `MAX_ID` = máximo `integer` de Postgres) y `RespuestaProductoDetalleSchema` (`GET /menu/productos/{id}`) y `ErrorMenuSchema`. `activo` y `disponible` se separan (D20) y los extras siguen D19.
- `src/pedido.ts`: contratos de `POST /pedidos/cotizar` y `POST /pedidos`. `CotizarPedidoPeticionSchema` (sobre de Retell `{ name: 'cotizar_pedido', args }`; no es estricto: `call` y otros campos se descartan), `CotizarPedidoArgsSchema` (`productos` y `extrasSueltos`, al menos uno; estricto: una llave desconocida da 400; en los campos opcionales `null` o `""` valen como "no vino"; la cantidad no se limita aquí, la revisa el servicio), `RespuestaCotizarPedidoSchema` (HTTP 200: `ok: true` con renglones y total en centavos más su texto, y `precioUnitarioTexto` en renglones y extras; u `ok: false` con `aclaraciones`), `CrearPedidoPeticionSchema` / `CrearPedidoArgsSchema` (`POST /pedidos`: el mismo pedido más `nombre` y `telefono`, que pueden faltar y los aclara el servicio; nunca montos), `RespuestaCrearPedidoSchema` (`ok: true` con folio, `folioTexto`, estado, `yaExistia`, renglones y total; u `ok: false` con `aclaraciones` y `datosCliente`), `ESTADOS_PEDIDO` y `ErrorPedidoSchema` (400 y 401). Reutiliza `IdSchema` y `CentavosSchema` de `menu.ts`.

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

Los esquemas se prueban desde quien los usa (por ejemplo, `apps/api/test/health.test.ts` valida la respuesta con `HealthResponseSchema.parse` y `apps/api/test/menu.contract.test.ts` prueba los esquemas del menú). El paquete no tiene tests propios.

## Reglas que aplican

- [Reglas de oro](../../CLAUDE.md#reglas-de-oro) del raíz (zod para toda entrada externa, centavos).
- [docs/negocio.md](../../docs/negocio.md): estados y reglas que los esquemas deben reflejar.
- [docs/decisiones.md](../../docs/decisiones.md): D7, D9, D19, D20.
