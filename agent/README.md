# agent/

Todo lo del agente de Retell vive aquí, **versionado en Git** y no solo en el dashboard de Retell.

| Ruta         | Propósito                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt.md`  | Prompt del agente. Es la fuente de verdad: si se cambia en el dashboard, se copia aquí en un PR.                                                          |
| `functions/` | Un archivo JSON (JSON Schema) por cada custom function (`buscar_menu`, `cotizar_pedido`, `crear_pedido`, …). Deben coincidir con los endpoints de la API. |
| `tests/`     | Casos de prueba de conversación: pedidos normales, ambigüedades e **intentos de manipulación**. Todo cambio al prompt debe pasarlos antes de fusionarse.  |

Reglas clave (CLAUDE.md §6):

- El agente **nunca** calcula precios. Los montos vienen del backend.
- El menú completo **no** va en el prompt. Se consulta con `buscar_menu`.
- Solo atiende temas del restaurante y se mantiene en su rol ante manipulación.
