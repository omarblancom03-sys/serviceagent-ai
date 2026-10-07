# Configuración del agente en Retell

El prompt vive en [prompt.md](./prompt.md). Todo lo demás que se configura en el dashboard de Retell y afecta el comportamiento o el costo vive en [retell.json](./retell.json). El dashboard es una copia: si un valor cambia allá, se cambia aquí en un PR.

## Cómo leer `retell.json`

Usa los nombres de campo de la API de Retell, para que no haya duda de a qué ajuste se refiere cada uno:

| Bloque       | Qué es                                      | Referencia oficial                                                                 |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `chat_agent` | Ajustes del agente de chat                  | [Create Chat Agent](https://docs.retellai.com/api-references/create-chat-agent.md) |
| `retell_llm` | Motor de respuesta: modelo, saludo y prompt | [Create Retell LLM](https://docs.retellai.com/api-references/create-retell-llm.md) |

- Lo que no aparece en el archivo se deja con el valor por defecto de Retell.
- `general_prompt` no trae el texto: apunta a `prompt.md`, que se copia completo.
- Un valor que empieza con `pendiente` todavía no está decidido; en el dashboard queda el valor por defecto de Retell hasta que se reemplace aquí.
- El archivo nunca lleva identificadores de la cuenta (id del agente, id del motor) ni llaves.

## Valores y dónde se configuran

| Campo                            | Dónde está en el dashboard                              | Notas                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_name`                     | Nombre del agente                                       | Nombre interno; el cliente no lo ve.                                                                                                                                                                     |
| `language`                       | Selector de idioma                                      | Retell ofrece `es-ES` y `es-419` (español de Latinoamérica); no existe una opción para México.                                                                                                           |
| `model`                          | Selector de modelo                                      | Se elige con la regla de [Modelo](#modelo).                                                                                                                                                              |
| `model_temperature`              | Engrane del modelo                                      | Solo aparece con algunos modelos: con `gpt-4.1-nano` sí; con `gpt-6-luna` y `gpt-5-nano` no (su engrane solo muestra "Structured Output"). El 0.2 acordado no se puede aplicar a `gpt-6-luna`.           |
| `start_speaker`, `begin_message` | Welcome Message → "AI speaks first" + "Dynamic message" | `begin_message` en `null`: el saludo lo redacta el modelo con la sección "Tu primer mensaje" del prompt. Un saludo fijo solo se puede poner por API.                                                     |
| `handbook_config`                | Botón "Agent Handbook", debajo del selector de modelo   | Preajustes de Retell que agregan texto propio al prompt. Apagados: el comportamiento se define solo en `prompt.md`.                                                                                      |
| `general_tools`                  | Lista de funciones del agente                           | Vacía. Retell agrega `end_call` por defecto y se quita: el prompt atiende al cliente si escribe después de la despedida.                                                                                 |
| `knowledge_base_ids`             | Knowledge base                                          | Vacía: el menú se consulta con RAG propio (D3).                                                                                                                                                          |
| `end_chat_after_silence_ms`      | Chat settings → Auto-Close Inactive Chats               | Va en milisegundos: 360000 son 6 minutos. El control solo avanza por saltos (6, 12, 30 minutos…).                                                                                                        |
| `auto_close_message`             | Chat settings                                           | Sin mensaje de cierre.                                                                                                                                                                                   |
| `timezone`                       | No aparece en el dashboard                              | Queda en `America/Los_Angeles`, el valor por defecto. El valor acordado es `America/Chihuahua`. Solo afecta a las variables de fecha y hora de Retell, que el prompt no usa.                             |
| `post_chat_analysis_model`       | Post chat extraction (panel derecho del agente)         | Retell resume cada chat al terminar y no se puede apagar. Se usa `gpt-5-nano`, que el dashboard muestra como gratuito ([D22](../docs/decisiones.md)). El valor por defecto de Retell es `gpt-5.6-terra`. |
| `data_storage_setting`           | Security & fallback settings → Data Storage Settings    | `everything`, el valor por defecto: guarda las transcripciones completas.                                                                                                                                |
| `data_storage_retention_days`    | Security & fallback settings → Data Storage Settings    | Retell borra los datos de cada chat a los 30 días. El valor por defecto es "Keep forever".                                                                                                               |
| `contact_memory_config`          | Ajustes de memoria de contacto                          | Valores por defecto. Según la documentación solo aplica a llamadas y SMS identificados por teléfono, no a chats web.                                                                                     |
| `webhook_url`                    | Webhook                                                 | Sin webhook: todavía no hay un endpoint que lo reciba.                                                                                                                                                   |

### Solo por API (decide Omar)

Dos valores acordados no se pueden fijar desde el dashboard. Se fijan con la API de Retell, que necesita la llave de la cuenta; usarla o no es decisión de Omar.

| Valor acordado                   | Campo y endpoint                                       |
| -------------------------------- | ------------------------------------------------------ |
| Saludo fijo, igual para todos    | `begin_message` en `PATCH /update-retell-llm/{llm_id}` |
| Zona horaria `America/Chihuahua` | `timezone` en `PATCH /update-chat-agent/{agent_id}`    |

El dashboard también tiene "Import" (en la lista de agentes), pero la documentación de Retell no describe qué campos respeta al importar un agente, así que no se usa.

## Modelo

Regla: [D22](../docs/decisiones.md). Se usa el modelo más barato de Retell que pase todos los casos; subir de nivel requiere aprobación del PO y se anota aquí.

El modelo elegido se escribe en `model` de `retell.json`, y el modelo con el que se probó queda en [tests/corrida.md](./tests/corrida.md).

Modelo elegido: `gpt-6-luna`, aprobado por el PO. Por qué se subió de nivel:

- `gpt-5-nano` pasó 7 de 11 casos con el prompt inicial y 8 de 11 con el ajustado. No respetaba de forma constante las reglas de no volver a presentarse ni de no ofrecer menú o pedidos.
- `gpt-6-luna` pasó 10 de 11 con ese mismo prompt y 11 de 11 tras un ajuste de una línea.

## Observaciones pendientes

- Con "Dynamic message", el saludo apareció duplicado 2 o 3 veces en el chat de prueba, con `gpt-5-nano` y con `gpt-6-luna`. Causa sin confirmar.

## Límite de mensajes por conversación

No se configura en Retell: el cierre por inactividad (`end_chat_after_silence_ms`) no limita cuántos mensajes se envían. Dónde se aplica el límite: [D21](../docs/decisiones.md).

## Pasos en el dashboard

1. **Agents → Create an Agent → Chat Agent**, tipo **Single prompt**.
2. Nombre del agente: `agent_name`.
3. Prompt: copiar el contenido completo de `prompt.md`, sin quitar ni agregar nada.
4. Modelo: `model`. Si el engrane del modelo muestra la temperatura, poner 0.2.
5. **Agent Handbook** (debajo del selector de modelo): apagar "Default Tone — Professional" y "AI Disclosure When Asked". Los demás quedan apagados.
6. **Welcome Message:** "AI speaks first" con "Dynamic message".
7. Idioma: `language`.
8. Funciones: quitar `end_call`, que viene agregada por defecto. No agregar functions, knowledge base ni webhook.
9. **Chat settings → Auto-Close Inactive Chats:** el valor de `end_chat_after_silence_ms`.
10. **Post chat extraction** (panel derecho del agente): en el selector de modelo, que queda debajo de los campos Chat Summary, Chat Successful y User Sentiment, elegir `post_chat_analysis_model`.
11. **Security & fallback settings → Data Storage Settings:** retención de `data_storage_retention_days` días.
12. Correr los casos de [tests/casos/](./tests/casos) en el chat de prueba ([CLAUDE.md → Cómo probar](./CLAUDE.md#cómo-probar)). El chat de prueba se cobra por mensaje, igual que un chat real.
13. Comparar contra el export (siguiente sección).
14. **Publish** para fijar la versión. Una versión publicada no se edita: para cambiarla se crea un borrador nuevo.

## Export del agente

"Export" está en el menú ··· del agente y descarga su configuración completa como JSON.

- **El export nunca entra al repo**: trae el id del motor de respuesta de la cuenta y una copia entera del prompt, que ya vive en `prompt.md`. Se guarda fuera de la carpeta del proyecto.
- Sirve para comprobar que el dashboard coincide con el repo: `retellLlmData.general_prompt` debe ser igual a `prompt.md`, y los demás campos, iguales a `retell.json`.
- Si algo no coincide, se corrige el dashboard. Si lo correcto es lo del dashboard, se cambia el repo en un PR.

## Cuando cambia el prompt o la configuración

1. El cambio se hace en `prompt.md` o `retell.json` y entra por PR.
2. Se copia a un borrador del agente en el dashboard.
3. Se corren todos los casos de `tests/casos/` y se actualiza `tests/corrida.md`.
4. Con el PR fusionado, se publica la versión.
