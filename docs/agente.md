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

Errores: `{ error, codigo }`, con `error` en español para el cliente y sin detalles técnicos.

| `codigo`                     | HTTP | Cuándo                                                                                                                                                                                                                      |
| ---------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `peticion_invalida`          | 400  | Texto vacío, solo espacios o de más de 500 caracteres; cuerpo o id mal formado                                                                                                                                              |
| `conversacion_no_encontrada` | 404  | Id bien formado que no existe                                                                                                                                                                                               |
| `conversacion_terminada`     | 409  | El chat cerró (por inactividad o porque terminó); la web ofrece iniciar otro                                                                                                                                                |
| `limite_alcanzado`           | 429  | Ya se enviaron los mensajes permitidos; hay que iniciar otra conversación                                                                                                                                                   |
| `servicio_no_disponible`     | 503  | Retell falló, tardó, no tiene saldo, llegó al límite de la cuenta o falta la llave; al iniciar, también si se alcanzó el tope diario de conversaciones nuevas. El texto del error puede variar según la causa; el código no |

### Cómo funciona el proxy

Lógica en `apps/api/src/services/chat.ts`; Retell se llama con `fetch` directo (`lib/clienteRetell.ts`) y el conteo, con las funciones atómicas de `conversaciones_chat` (`lib/repoChat.ts`, [D36](decisiones.md)).

**Iniciar** (`POST /chat/conversaciones`):

1. Si falta `RETELL_API_KEY` o `RETELL_AGENT_ID`: 503 **antes** de abrir la conversación, así que no gasta tope.
2. `abrir_conversacion_chat` con el tope diario ([D38](decisiones.md)). Si ya se llegó: 503 con "El chat llegó a su límite de hoy…", sin llamar a Retell.
3. `create-chat` (timeout 10 s). Si falla por cualquier causa, o el chat no queda `ongoing`, o no se puede guardar su `chat_id`: se termina la conversación y 503.
4. 201 con los mensajes `agent` que traiga `message_with_tool_calls` (o vacío), 0 usados y límite 30.

**Enviar** (`POST /chat/conversaciones/{id}/mensajes`):

1. Id o cuerpo mal formados (incluido JSON inválido): 400 sin tocar la base. Sin `RETELL_API_KEY`: 503 sin tocar la base.
2. `registrar_mensaje_chat` cuenta el mensaje **antes** de mandarlo: si no existe, 404; si terminó, 409; si ya hay 30, 429. En los tres casos no se llama a Retell.
3. `create-chat-completion` (timeout 30 s). Si responde bien: 200 solo con los mensajes `agent` con texto (puede ser vacío). Si a un mensaje le falta el id o la hora, la API los genera.
4. Si Retell falla, se aplica [D39](decisiones.md):

| Respuesta de Retell                             | Mensaje contado                         | HTTP |
| ----------------------------------------------- | --------------------------------------- | ---- |
| 400 o 422 y `get-chat` (5 s) dice `ended`       | Se devuelve; la conversación se termina | 409  |
| 400, 401, 402, 422 o 429 (rechazo sin procesar) | Se devuelve                             | 503  |
| Error de conexión antes de recibir respuesta    | Se devuelve                             | 503  |
| Timeout, 5xx, otro estado o respuesta ilegible  | Se queda contado (pudo cobrarse)        | 503  |

- Un error de conexión también puede ocurrir después de que Retell recibió el mensaje; no se distingue y se devuelve igual (riesgo aceptado en D39).
- Si falla la base de datos, 503. Si falla al terminar o devolver mientras se atiende otra falla, solo se anota en el log.
- Los logs llevan solo la operación, la clase de falla y el código HTTP: nunca la llave, el texto del cliente ni el `chat_id`.

**Limitación conocida:** si Retell falla al abrir, el lugar del tope diario queda gastado aunque Retell claramente no haya creado el chat (un 4xx): una caída de Retell consume los lugares del día. Devolverlo requiere una función SQL nueva (el tope cuenta las filas creadas ese día y la API no puede borrarlas). Es una mejora pendiente ([D39](decisiones.md)).

**Confirmado en la prueba real** (la documentación de Retell no lo dice):

- `create-chat` no trae el saludo del agente: `mensajes` sale vacío, así que la pantalla de `/pedir` muestra su propio saludo. También con el saludo fijo ("Custom message"), confirmado el 17 de octubre de 2026: la primera respuesta de `create-chat-completion` trae solo la respuesta del agente, sin el saludo fijo.
- El `chat_id` empieza con `chat_` y mide 32 caracteres. La API acepta de 1 a 128, el largo de la columna.
- Con un chat cerrado por inactividad, `create-chat-completion` responde 400; la API consulta `get-chat` (`ended`), termina la conversación, devuelve el mensaje y responde 409. A los 13 minutos sin actividad el chat ya estaba cerrado; no se midió si cierra exactamente a los 6.
- La llave de API de Retell que se usó en la prueba sirve para llamar a la API de chat (`create-chat` y `create-chat-completion`).
- Cada respuesta del agente tardó de 2.6 a 4 s.

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
- El conteo de mensajes del cliente por conversación, las conversaciones que abrió nuestra API y el tope diario de conversaciones nuevas viven en la tabla `conversaciones_chat` de Supabase ([supabase/CLAUDE.md](../supabase/CLAUDE.md)); la API los aplica con funciones atómicas ([D14](decisiones.md)).
- Nunca revela datos de otros clientes.
- Todo cambio al prompt pasa por PR y debe pasar los casos de `agent/tests/` con el criterio de [D43](decisiones.md): salirse del alcance o ceder a una manipulación es regla dura, sin tolerancia.
