# agent/ — Agente de Retell

## Qué es

Todo lo del agente de Retell, **versionado en Git** y no solo en el dashboard de Retell. El dashboard es una copia: la fuente de verdad es este directorio.

## Cómo está organizado

| Ruta                      | Propósito                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt.md`               | Prompt del agente. El archivo **completo** se copia al dashboard; por eso no lleva notas para el equipo.                                                                                                       |
| `retell.json`             | Configuración del agente que no es el prompt (idioma, saludo, cierre por inactividad, modelo), con los nombres de campo de la API de Retell.                                                                   |
| `retell.md`               | Qué significa cada valor de `retell.json` y los pasos para copiarlo al dashboard y publicar.                                                                                                                   |
| `functions/`              | Un archivo JSON por custom function: solo el JSON Schema de sus parámetros, que se pega completo en el dashboard. Hoy: `cotizar_pedido.json`. Las demás se definen en su historia.                             |
| `tests/casos/`            | Un caso de conversación por archivo JSON: personalidad, peticiones ajenas, despedida, "no inventar" y pedidos. La batería completa de manipulación se define en US-48.                                         |
| `tests/corrida.md`        | Resultado de la última corrida manual de todos los casos: fecha, modelo y, por caso, si pasó o falló con un resumen de una línea.                                                                              |
| `tests/casos.test.ts`     | Vitest: valida el formato de los casos, la cobertura por historia, que `corrida.md` tenga una fila por caso, que el prompt no tenga montos y que ningún archivo de `agent/` guarde ids de la cuenta ni llaves. |
| `tests/funciones.test.ts` | Vitest: compara cada JSON de `functions/` con su contrato zod de `packages/shared` (mismas llaves, mismas obligatorias, sin llaves de más) y revisa su entrada en `retell.json`.                               |

`agent/` es un paquete del workspace (`@serviceagent/agent`) solo para que `pnpm lint`, `pnpm typecheck` y `pnpm test` lo cubran; no se despliega ni lo importa otro paquete. Sus tests importan `@serviceagent/shared` para validar contra el contrato real.

## Convenciones de esta área

- Los nombres de función y sus endpoints son los de la tabla de [docs/agente.md](../docs/agente.md#custom-functions); el JSON de `functions/` debe coincidir con el contrato del endpoint, y `tests/funciones.test.ts` lo comprueba. El nombre, la descripción, la ruta y los demás ajustes de la función van en `general_tools` de `retell.json`.
- El menú completo **no** va en el prompt: se consulta con `buscar_menu`.
- El prompt nunca pide al modelo calcular montos; los montos vienen de `cotizar_pedido`.
- La sección "Lo que puedes hacer hoy" del prompt dice qué hace el agente con lo que aún no tiene herramienta. La historia que agrega una custom function reemplaza ahí su línea y ajusta los casos `sin_inventar` que correspondan.
- El archivo que descarga "Export" en Retell **nunca entra al repo**: trae ids de la cuenta y una copia del prompt. Se guarda fuera del proyecto y solo se usa para comparar ([retell.md → Export del agente](./retell.md#export-del-agente)).
- `retell.json` no lleva ids de la cuenta ni llaves. El modelo se elige con la regla de [retell.md → Modelo](./retell.md#modelo).

### Formato de un caso (`tests/casos/<id>.json`)

| Campo           | Contenido                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | En minúsculas con guiones, sin acentos; igual al nombre del archivo.                                                                                                      |
| `historia`      | Historia que agregó el caso (`US-06`, `US-07-P2`).                                                                                                                        |
| `criterios`     | Criterios de aceptación que comprueba (`["C3"]`). Vacío si protege una regla de `docs/agente.md`.                                                                         |
| `categoria`     | `personalidad`, `fuera_de_alcance`, `manipulacion`, `sin_inventar`, `despedida` o `pedido`.                                                                               |
| `titulo`        | Qué comprueba, en una línea.                                                                                                                                              |
| `mensajes`      | Lo que escribe el cliente, en orden. Se envían uno por uno.                                                                                                               |
| `respuestas`    | Opcional. Qué contesta el cliente según lo que pregunte el agente, cuando el orden lo decide el agente.                                                                   |
| `argsEsperados` | Obligatorio en `pedido`. Los args de cada llamada esperada a `cotizar_pedido`, en orden, salvo que `debe` diga que solo fija la última. El test los pasa por el contrato. |
| `debe`          | Lo que tienen que cumplir las respuestas del agente.                                                                                                                      |
| `noDebe`        | Lo que ninguna respuesta puede hacer.                                                                                                                                     |

El caso **pasa** si se cumple todo `debe` y nada de `noDebe`. No se compara texto exacto: lo juzga la persona que prueba.

## Cómo probar

1. **Formato (automático):** `pnpm --filter @serviceagent/agent test`. También corre dentro de `pnpm test` y en CI.
2. **Conversación (a mano):** con el prompt y la configuración copiados a un borrador del agente ([retell.md](./retell.md)), abrir el chat de prueba del dashboard y, por cada archivo de `tests/casos/`:
   - Empezar una conversación nueva.
   - Enviar los `mensajes` en orden, uno por uno.
   - Revisar las respuestas contra `debe` y `noDebe`, y los args de cada llamada contra `argsEsperados`: se compara el sentido, no el texto ("hamburguesa" y "hamburguesas" valen igual).
3. Si un caso falla, se corrige el prompt y se corren **todos** los casos otra vez: un arreglo puede romper otro caso.
4. El resultado se anota en `tests/corrida.md`, que se reemplaza completo en cada corrida (guarda la última, no un historial). Se actualiza en el mismo PR cada vez que cambia `prompt.md`, `retell.json` o un caso. Un caso nuevo agrega su fila.
5. No se usan las simulaciones de Retell: cobran por mensaje. Quién prueba en Retell, cuándo y cómo se anotan los mensajes usados: [D22](../docs/decisiones.md).

Todo cambio al prompt debe pasar todos los casos antes de fusionarse (Definition of Done).

## Reglas que aplican

- [docs/agente.md](../docs/agente.md): custom functions, comportamiento y seguridad del agente.
- [docs/negocio.md](../docs/negocio.md): dinero, estados del pedido y cancelación.
- [docs/proceso.md → Definition of Done](../docs/proceso.md#definition-of-done) (punto 6).
- [docs/decisiones.md](../docs/decisiones.md): D3, D4, D21, D22.
