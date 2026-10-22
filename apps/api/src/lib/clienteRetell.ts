import { z } from 'zod';
import type { ClienteRetell, MensajeRetell, ResultadoRetell } from '../services/chat';

/**
 * Cliente de la API de chat de Retell con `fetch` directo (sin el SDK).
 * Referencia: https://docs.retellai.com/api-references/create-chat (y create-chat-completion,
 * get-chat). La llave solo viaja en el encabezado `Authorization`; nunca se registra en logs.
 */

const URL_RETELL = 'https://api.retellai.com';

/**
 * Versión del agente con la que se abre cada chat: la publicada más reciente. Sin `agent_version`,
 * Retell usa `latest` (el número de versión más alto, aunque sea el borrador), y un cambio a medio
 * probar en el borrador llegaría a los clientes de `/pedir` (D52).
 */
export const VERSION_AGENTE = 'latest_published';

/** Milisegundos máximos por llamada. La respuesta del agente tarda más si usa herramientas. */
export const TIMEOUTS_RETELL = {
  crearChat: 10_000,
  enviarMensaje: 30_000,
  consultarEstado: 5_000,
};

/** Estados con los que Retell rechaza la petición antes de procesarla (D39). */
const ESTADOS_RECHAZO = new Set([400, 401, 402, 422, 429]);

/** La hora más lejana que acepta `Date` (8.64e15 ms). */
const MAX_MS = 8_640_000_000_000_000;

// Las respuestas se leen con tolerancia: un mensaje raro se descarta o se completa, no
// tumba la respuesta entera. Solo falla si falta lo indispensable (chat_id, messages).
const MensajeCrudoSchema = z.object({
  role: z.string(),
  message_id: z.unknown().optional(),
  content: z.unknown().optional(),
  created_timestamp: z.unknown().optional(),
});

function leerMensajes(crudos: unknown[]): MensajeRetell[] {
  return crudos.flatMap((crudo) => {
    const m = MensajeCrudoSchema.safeParse(crudo);
    if (!m.success) return [];
    const { role, message_id: id, content, created_timestamp: ms } = m.data;
    return [
      {
        rol: role,
        id: typeof id === 'string' && id !== '' ? id : null,
        texto: typeof content === 'string' ? content : null,
        creadoEnMs:
          typeof ms === 'number' && Number.isSafeInteger(ms) && ms >= 0 && ms <= MAX_MS ? ms : null,
      },
    ];
  });
}

const ChatCreadoSchema = z
  .object({
    // Mismo largo que permite la columna `chat_id_retell`.
    chat_id: z.string().min(1).max(128),
    chat_status: z.string(),
    message_with_tool_calls: z.array(z.unknown()).nullish(),
  })
  .transform((c) => ({
    chatId: c.chat_id,
    estado: c.chat_status,
    mensajes: leerMensajes(c.message_with_tool_calls ?? []),
  }));

const CompletadoSchema = z
  .object({ messages: z.array(z.unknown()) })
  .transform((r) => ({ mensajes: leerMensajes(r.messages) }));

const EstadoChatSchema = z
  .object({ chat_status: z.string() })
  .transform((c) => ({ estado: c.chat_status }));

export interface OpcionesClienteRetell {
  /** Para los tests: un `fetch` falso. Por defecto, el del Worker. */
  fetch?: typeof fetch;
  timeouts?: Partial<typeof TIMEOUTS_RETELL>;
}

export function crearClienteRetell(
  llave: string,
  opciones: OpcionesClienteRetell = {},
): ClienteRetell {
  const hacerFetch = opciones.fetch ?? ((url, init) => fetch(url, init));
  const timeouts = { ...TIMEOUTS_RETELL, ...opciones.timeouts };

  async function llamar<T>(
    ruta: string,
    init: { method: string; body?: unknown },
    timeoutMs: number,
    esquema: z.ZodType<T>,
  ): Promise<ResultadoRetell<T>> {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), timeoutMs);
    try {
      let res: Response;
      try {
        res = await hacerFetch(`${URL_RETELL}${ruta}`, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${llave}`,
            ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: control.signal,
        });
      } catch {
        return { ok: false, falla: control.signal.aborted ? 'timeout' : 'sin_conexion' };
      }

      // El cuerpo de un error de Retell no se lee: nunca llega al cliente ni a los logs.
      if (!res.ok) {
        return {
          ok: false,
          falla: ESTADOS_RECHAZO.has(res.status) ? 'rechazo' : 'incierta',
          status: res.status,
        };
      }

      let cuerpo: unknown;
      try {
        cuerpo = await res.json();
      } catch {
        return {
          ok: false,
          falla: control.signal.aborted ? 'timeout' : 'incierta',
          status: res.status,
        };
      }
      const leido = esquema.safeParse(cuerpo);
      return leido.success
        ? { ok: true, datos: leido.data }
        : { ok: false, falla: 'incierta', status: res.status };
    } finally {
      clearTimeout(temporizador);
    }
  }

  return {
    crearChat: (agentId) =>
      llamar(
        '/create-chat',
        { method: 'POST', body: { agent_id: agentId, agent_version: VERSION_AGENTE } },
        timeouts.crearChat,
        ChatCreadoSchema,
      ),
    enviarMensaje: (chatId, texto) =>
      llamar(
        '/create-chat-completion',
        { method: 'POST', body: { chat_id: chatId, content: texto } },
        timeouts.enviarMensaje,
        CompletadoSchema,
      ),
    consultarEstado: (chatId) =>
      llamar(
        `/get-chat/${encodeURIComponent(chatId)}`,
        { method: 'GET' },
        timeouts.consultarEstado,
        EstadoChatSchema,
      ),
  };
}
