# agent/ — Agente de Retell

## Qué es

Todo lo del agente de Retell, **versionado en Git** y no solo en el dashboard de Retell. El dashboard es una copia: la fuente de verdad es este directorio.

## Cómo está organizado

| Ruta         | Propósito                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `prompt.md`  | Prompt del agente. Hoy es un placeholder; el prompt real se define en US-06. Si se cambia en el dashboard, se copia aquí en un PR. |
| `functions/` | Un archivo JSON (JSON Schema) por custom function (`buscar_menu`, `cotizar_pedido`, `crear_pedido`…). Hoy vacía; se define en US-06 y en la historia de cada función. |
| `tests/`     | Casos de prueba de conversación: pedidos normales, ambigüedades e **intentos de manipulación**. Hoy vacía; la batería de manipulación se define en US-48. |

## Convenciones de esta área

- Los nombres de función y sus endpoints son los de la tabla de [docs/agente.md](../docs/agente.md#custom-functions); el JSON de `functions/` debe coincidir con el endpoint de la API.
- El menú completo **no** va en el prompt: se consulta con `buscar_menu`.
- El prompt nunca pide al modelo calcular montos; los montos vienen de `cotizar_pedido`.
- Formato de los casos de `tests/`: pendiente: se define en US-06.

## Cómo probar

Pendiente: se define en US-06. Todo cambio al prompt debe pasar los casos de `tests/` antes de fusionarse (Definition of Done).

## Reglas que aplican

- [docs/agente.md](../docs/agente.md): custom functions, comportamiento y seguridad del agente.
- [docs/negocio.md](../docs/negocio.md): dinero, estados del pedido y cancelación.
- [docs/proceso.md → Definition of Done](../docs/proceso.md#definition-of-done) (punto 6).
- [docs/decisiones.md](../docs/decisiones.md): D3, D4.
