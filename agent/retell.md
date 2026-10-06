# Configuración del agente en Retell

El prompt vive en [prompt.md](./prompt.md). Todo lo demás que se configura en el dashboard de Retell vive en [retell.json](./retell.json). El dashboard es una copia: si un valor cambia allá, se cambia aquí en un PR.

## Cómo leer `retell.json`

Usa los nombres de campo de la API de Retell, para que no haya duda de a qué ajuste se refiere cada uno:

| Bloque       | Qué es                                      | Referencia oficial                                                                 |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `chat_agent` | Ajustes del agente de chat                  | [Create Chat Agent](https://docs.retellai.com/api-references/create-chat-agent.md) |
| `retell_llm` | Motor de respuesta: modelo, saludo y prompt | [Create Retell LLM](https://docs.retellai.com/api-references/create-retell-llm.md) |

- Lo que no aparece en el archivo se deja con el valor por defecto de Retell.
- `general_prompt` no trae el texto: apunta a `prompt.md`, que se copia completo.
- Un valor que empieza con `pendiente` todavía no está decidido; no se configura hasta que se reemplace aquí.
- El archivo nunca lleva identificadores de la cuenta (id del agente, id del motor) ni llaves.

## Valores

| Campo                                 | Para qué sirve                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `agent_name`                          | Nombre interno del agente; el cliente no lo ve.                                                                                   |
| `language`                            | Retell ofrece `es-ES` y `es-419` (español de Latinoamérica); no existe una opción para México.                                    |
| `timezone`                            | Zona horaria del restaurante. Si no se configura, Retell usa `America/Los_Angeles`.                                               |
| `end_chat_after_silence_ms`           | Cierra el chat si el cliente deja de responder. Va en milisegundos: 600000 son 10 minutos. Retell acepta de 2 minutos a 72 horas. |
| `auto_close_message`                  | Mensaje que ve el cliente cuando el chat se cierra solo.                                                                          |
| `webhook_url`                         | Sin webhook: todavía no hay un endpoint que lo reciba.                                                                            |
| `model`                               | Modelo de lenguaje. Se elige con la regla de [Modelo](#modelo).                                                                   |
| `model_temperature`                   | Qué tan variable es la respuesta, de 0 a 1. Un valor bajo da respuestas más parejas entre clientes.                               |
| `start_speaker`, `begin_message`      | El agente habla primero con un saludo fijo, igual para todos los clientes.                                                        |
| `general_tools`, `knowledge_base_ids` | Vacíos: las custom functions llegan con su historia y el menú se consulta con RAG propio (D3).                                    |

## Modelo

Regla: el modelo más barato de Retell que pase los 11 casos; si falla, se sube de nivel y se anota.

El modelo elegido se escribe en `model` de `retell.json`, y el modelo con el que se probó queda en [tests/corrida.md](./tests/corrida.md).

## Límite de mensajes por conversación

No se configura en Retell: el cierre por inactividad (`end_chat_after_silence_ms`) no limita cuántos mensajes se envían. Dónde se aplica el límite: [D21](../docs/decisiones.md).

## Pasos en el dashboard

Los nombres de botones pueden variar; los campos son los de `retell.json`.

1. **Agents → Create an Agent → Chat Agent**, tipo **Single prompt**.
2. Nombre del agente: `agent_name`.
3. Prompt: copiar el contenido completo de `prompt.md`, sin quitar ni agregar nada.
4. Mensaje de bienvenida: el agente habla primero con el texto de `begin_message`.
5. Modelo y temperatura: `model` y `model_temperature`.
6. Idioma: `language`. Zona horaria: `timezone`.
7. Cierre por inactividad: `end_chat_after_silence_ms` y `auto_close_message`.
8. No agregar functions, knowledge base ni webhook.
9. Verificar en el dashboard si existe una herramienta para terminar el chat. La documentación solo describe `end_call` para llamadas de voz. Si existe, no se activa: primero se anota aquí y en `retell.json` por PR.
10. Correr los casos de [tests/casos/](./tests/casos) en el chat de prueba ([CLAUDE.md → Cómo probar](./CLAUDE.md#cómo-probar)).
11. **Publish** para fijar la versión. Una versión publicada no se edita: para cambiarla se crea un borrador nuevo.

## Cuando cambia el prompt o la configuración

1. El cambio se hace en `prompt.md` o `retell.json` y entra por PR.
2. Se copia a un borrador del agente en el dashboard.
3. Se corren todos los casos de `tests/casos/`.
4. Con el PR fusionado, se publica la versión.
