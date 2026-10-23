# packages/shared — Esquemas y tipos compartidos

## Qué es

Paquete `@serviceagent/shared`: esquemas zod, tipos y constantes que usan la API y los frontends. Es la única definición de cada contrato; nadie redefine un esquema en su app.

## Cómo está organizado

- `src/index.ts`: reexporta todo (`export * from './<archivo>'`). Es la única entrada del paquete.
- `src/chat.ts`: contrato del chat web ([docs/agente.md → Chat web](../../docs/agente.md#chat-web-proxy)). `LIMITE_MENSAJES_CLIENTE` (30), `MAX_CARACTERES_MENSAJE` (500), `CODIGOS_ERROR_CHAT`, `IdConversacionSchema` (`z.uuid()`: el id de la tabla `conversaciones_chat`), `ParamsConversacionSchema`, `EnviarMensajePeticionSchema` (estricto; `texto` recortado), `MensajeAgenteSchema` (`id`, `texto`, `creadoEn`), `RespuestaIniciarConversacionSchema`, `RespuestaEnviarMensajeSchema` (`mensajesUsados` ≤ `limiteMensajes`) y `ErrorChatSchema` (`{ error, codigo }`). Las respuestas no son estrictas, para no romper a la web con campos nuevos; que no traigan campos de herramientas lo prueba `apps/api/test/chat.contract.test.ts`.
- `src/cocina.ts`: contrato de la pantalla de cocina (US-10). `ESTADOS_COCINA` (`en_cola`, `preparando`), `RenglonCocinaSchema` (platillo con variante, ingredientes quitados y extras, o extra suelto), `TicketCocinaSchema` (folio, `folioTexto`, nombre, estado, `enColaDesde` y renglones; sin precios ni teléfono), `RespuestaPedidosCocinaSchema` (`GET /cocina/pedidos`), `ErrorCocinaSchema` y el canal y evento de la señal de Realtime (`CANAL_SENAL_PEDIDOS`, `EVENTO_SENAL_PEDIDOS`, D47).
- `src/busqueda.ts`: contrato de `POST /agente/buscar-menu` (custom function `buscar_menu`, US-16, D50). `BuscarMenuPeticionSchema` (sobre de Retell; `args` estricto: solo `consulta`, de 1 a 200 caracteres), `RespuestaBuscarMenuSchema` (hasta `MAX_RESULTADOS_BUSQUEDA` = 5 platillos con nombre oficial, categoría, descripción, disponibilidad y precios; `presentacion` en `null` si el platillo tiene una sola) y `ErrorBusquedaSchema`.
- `src/health.ts`: `HealthResponseSchema` y `HealthResponse`, la respuesta de `GET /health`.
- `src/auth.ts`: roles, PIN, login, sesión, errores de autenticación, `TokenPayloadSchema` (estricto: solo `sub`, `rol`, `exp`) y `SesionActualSchema` (respuesta de `GET /auth/sesion`: `{ empleado, exp }`).
- `src/menu.ts`: contrato del menú público. `CategoriaSchema`, `VarianteSchema` (con el precio), `PlatilloSchema` (al menos una variante, sus `extrasPermitidos` e `ingredientesRemovibles`; `tiempoEstimadoMin` puede ser `null`), `IngredienteRemovibleSchema`, `ExtraSchema` (extras sueltos), `CategoriaMenuSchema`, `RespuestaMenuSchema` (`GET /menu`), `ParamsProductoSchema` (solo dígitos, hasta `MAX_ID` = máximo `integer` de Postgres) y `RespuestaProductoDetalleSchema` (`GET /menu/productos/{id}`) y `ErrorMenuSchema`. `activo` y `disponible` se separan (D20) y los extras siguen D19.
- `src/pedido.ts`: contratos de `POST /pedidos/cotizar` y `POST /pedidos`. `CotizarPedidoPeticionSchema` (sobre de Retell `{ name: 'cotizar_pedido', args }`; no es estricto: `call` y otros campos se descartan), `CotizarPedidoArgsSchema` (`productos` y `extrasSueltos`, al menos uno; estricto: una llave desconocida da 400; en los campos opcionales `null` o `""` valen como "no vino"; la cantidad no se limita aquí, la revisa el servicio), `RespuestaCotizarPedidoSchema` (HTTP 200: `ok: true` con renglones y total en centavos más su texto, `precioUnitarioTexto` en renglones y extras, y `extrasDisponibles` en cada platillo, lo único que el agente puede ofrecer (D44); u `ok: false` con `aclaraciones`), `CrearPedidoPeticionSchema` / `CrearPedidoArgsSchema` (`POST /pedidos`: el mismo pedido más `nombre` y `telefono`, que pueden faltar y los aclara el servicio; nunca montos), `RespuestaCrearPedidoSchema` (`ok: true` con folio, `folioTexto`, estado, `yaExistia`, renglones y total; u `ok: false` con `faltaConfirmacion`, `aclaraciones` y `datosCliente`), `MensajeConversacionSchema` (un mensaje de la conversación: `role`, `content` y `name`, estos dos opcionales o `null`) y `CallRetellSchema` (`call.message_with_tool_calls`, que la API lee mensaje por mensaje para revisar la confirmación, D48), `ESTADOS_PEDIDO` y `ErrorPedidoSchema` (400 y 401). Reutiliza `IdSchema` y `CentavosSchema` de `menu.ts`.

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
