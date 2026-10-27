import { z } from 'zod';

/*
 * Lectura del objeto `chat` que Retell manda a una custom function en un agente de chat:
 * `{ name, chat, args }` (D59). Es el ÚNICO lugar que sabe en qué llave viene el id del chat.
 * `chat` también trae la transcripción (`transcript`, `message_with_tool_calls`): aquí no se lee.
 */

/** Mismo largo que acepta `conversaciones_chat` y `alertas_atencion` para el `chat_id`. */
export const MAX_LARGO_ID_CHAT = 128;

/** Solo la llave que se usa; las demás se ignoran sin leerse. */
const ChatConIdSchema = z.looseObject({
  chat_id: z.string().min(1).max(MAX_LARGO_ID_CHAT),
});

/**
 * El `chat.chat_id` del sobre de Retell, o `null` si `chat` falta, no es objeto, no trae la llave o
 * no es un texto de 1 a 128 caracteres. Nunca lanza: una forma rara no es un 400 ni un 500.
 */
export function idDelChat(chat: unknown): string | null {
  const leido = ChatConIdSchema.safeParse(chat);
  return leido.success ? leido.data.chat_id : null;
}

/** Solo los NOMBRES de las llaves de `chat`, para el log: nunca sus valores. */
export function llavesDelChat(chat: unknown): string[] {
  return chat !== null && typeof chat === 'object' && !Array.isArray(chat) ? Object.keys(chat) : [];
}
