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

## Chat web (proxy)

La web no usa el widget de Retell: habla con nuestra API, que habla con Retell. La llave de Retell vive solo en el servidor ([D21](decisiones.md)). Contrato en `packages/shared/src/chat.ts`; detalle de cada campo en Swagger (`/docs`).

| Endpoint                                  | Respuesta                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /chat/conversaciones`               | 201: `conversacionId`, `mensajes` (lo que el agente escribió al abrir; puede venir vacío), `mensajesUsados` (0) y `limiteMensajes`     |
| `POST /chat/conversaciones/{id}/mensajes` | Cuerpo `{ texto }` (se recorta; 1 a 500 caracteres). 200: `mensajes` (solo los nuevos del agente), `mensajesUsados` y `limiteMensajes` |

- Cada mensaje trae solo `id`, `texto` y `creadoEn` (ISO 8601 UTC). La API solo devuelve el texto de los mensajes de Retell con `role` `agent`: nunca invocaciones ni resultados de herramientas, transiciones ni datos técnicos.
- La API cuenta los mensajes del cliente por conversación y devuelve `mensajesUsados` y `limiteMensajes` (30, [D21](decisiones.md)).
- El id público de la conversación es el uuid de nuestra tabla `conversaciones_chat`; el `chat_id` de Retell nunca sale del servidor. Un id que no es uuid da 400 `peticion_invalida`.
- Sin verificar en la documentación de Retell: si `create-chat` trae el saludo del agente y qué error da un chat ya cerrado.

Errores: `{ error, codigo }`, con `error` en español para el cliente y sin detalles técnicos.

| `codigo`                     | HTTP | Cuándo                                                                                                                                                                                                                      |
| ---------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `peticion_invalida`          | 400  | Texto vacío, solo espacios o de más de 500 caracteres; cuerpo o id mal formado                                                                                                                                              |
| `conversacion_no_encontrada` | 404  | Id bien formado que no existe                                                                                                                                                                                               |
| `conversacion_terminada`     | 409  | El chat cerró (por inactividad o porque terminó); la web ofrece iniciar otro                                                                                                                                                |
| `limite_alcanzado`           | 429  | Ya se enviaron los mensajes permitidos; hay que iniciar otra conversación                                                                                                                                                   |
| `servicio_no_disponible`     | 503  | Retell falló, tardó, no tiene saldo, llegó al límite de la cuenta o falta la llave; al iniciar, también si se alcanzó el tope diario de conversaciones nuevas. El texto del error puede variar según la causa; el código no |

## Comportamiento

- Español mexicano, amable y breve.
- Si falta información, pregunta una sola vez sugiriendo la opción más común ("¿sería la hamburguesa clásica?").
- **Repite el resumen del pedido UNA sola vez, al final, antes de confirmar.** No en cada paso.
- Nunca inventa productos, precios ni ingredientes. Si no sabe, lo dice. Los montos siempre vienen del backend ([negocio.md → Dinero](negocio.md#dinero)).
- Si no puede resolver algo, usa `transferir_a_empleado`.
- El menú completo **no** va en el prompt: se consulta con `buscar_menu` (ahorro de tokens).

## Modelo y costo en Retell

- Modelo del agente de chat, por qué se eligió y el resto de la configuración: [agent/retell.md → Modelo](../agent/retell.md#modelo).
- Reglas para cuidar el saldo (qué modelo, quién prueba en Retell y cuándo): [D22](decisiones.md).
- Cada PR anota los mensajes que usó en Retell ([D22](decisiones.md), punto 5).

## Seguridad (prioridad del PO)

- Solo atiende temas del restaurante. Rechaza con amabilidad cualquier otra cosa (programar, tareas, otros temas) y regresa al pedido.
- Se mantiene en su rol ante intentos de manipulación ("ignora tus instrucciones", "actúa como…").
- Límites fuera de la IA: Turnstile, conversaciones por IP/teléfono por hora, mensajes por conversación, duración máxima y tope de gasto diario. Dónde se aplican: [D21](decisiones.md).
- Nunca revela datos de otros clientes.
- Todo cambio al prompt pasa por PR y debe pasar los casos de `agent/tests/` (incluidos los de manipulación).
