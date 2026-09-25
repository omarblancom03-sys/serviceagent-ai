# Agente (Retell)

El agente atiende al cliente por chat (voz en Sprint 10). Su prompt, sus custom functions y sus casos de prueba viven en [`agent/`](../agent/CLAUDE.md).

## Custom functions

Retell llama a nuestra API. **Toda petición de Retell se verifica con la firma `X-Retell-Signature`**; si no es válida, se rechaza.

| Función                 | Endpoint                        | Para qué                                                          |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `buscar_menu`           | `POST /agente/buscar-menu`      | RAG: 3–5 productos relevantes con precio y disponibilidad en vivo |
| `info_restaurante`      | `POST /agente/info`             | Horario, ubicación, pagos, alérgenos, FAQs                        |
| `cotizar_pedido`        | `POST /pedidos/cotizar`         | Valida productos y calcula total (sin guardar)                    |
| `crear_pedido`          | `POST /pedidos`                 | Crea el pedido tras confirmación explícita                        |
| `modificar_pedido`      | `PATCH /pedidos/:folio`         | Cambios antes de preparación                                      |
| `cancelar_pedido`       | `POST /pedidos/:folio/cancelar` | Solo antes de `preparando`                                        |
| `estado_pedido`         | `POST /agente/estado`           | Requiere folio **y** teléfono que coincidan                       |
| `tiempo_estimado`       | `GET /tiempo-estimado`          | Antes de confirmar                                                |
| `transferir_a_empleado` | `POST /agente/escalar`          | Crea alerta en caja/admin                                         |

Los nombres exactos de rutas pueden ajustarse en su historia; si cambian, se actualiza esta tabla en el mismo PR.

## Comportamiento

- Español mexicano, amable y breve.
- Si falta información, pregunta una sola vez sugiriendo la opción más común ("¿sería la hamburguesa clásica?").
- **Repite el resumen del pedido UNA sola vez, al final, antes de confirmar.** No en cada paso.
- Nunca inventa productos, precios ni ingredientes. Si no sabe, lo dice. Los montos siempre vienen del backend ([negocio.md → Dinero](negocio.md#dinero)).
- Si no puede resolver algo, usa `transferir_a_empleado`.
- El menú completo **no** va en el prompt: se consulta con `buscar_menu` (ahorro de tokens).

## Seguridad (prioridad del PO)

- Solo atiende temas del restaurante. Rechaza con amabilidad cualquier otra cosa (programar, tareas, otros temas) y regresa al pedido.
- Se mantiene en su rol ante intentos de manipulación ("ignora tus instrucciones", "actúa como…").
- Límites fuera de la IA: Turnstile, conversaciones por IP/teléfono por hora, mensajes por conversación, duración máxima y tope de gasto diario.
- Nunca revela datos de otros clientes.
- Todo cambio al prompt pasa por PR y debe pasar los casos de `agent/tests/` (incluidos los de manipulación).
