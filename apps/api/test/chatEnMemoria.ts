import type { ChatRepo, ClienteRetell, MensajeRetell, ResultadoRetell } from '../src/services/chat';

interface FilaConversacion {
  id: string;
  chatIdRetell: string | null;
  mensajesUsados: number;
  terminadaEn: Date | null;
  creadoEn: Date;
}

/** Día calendario del restaurante, como `(p_ahora at time zone 'America/Chihuahua')::date`. */
const diaChihuahua = (fecha: Date) =>
  fecha.toLocaleDateString('en-CA', { timeZone: 'America/Chihuahua' });

/**
 * `ChatRepo` en memoria que imita las funciones SQL de `conversaciones_chat`: tope por día de
 * Chihuahua, conversación sin `chat_id` como no encontrada, terminada, límite y devolver sin
 * bajar de 0. Cada operación lee y escribe sin `await` de por medio, así que es atómica.
 */
export function crearChatRepoEnMemoria() {
  const filas = new Map<string, FilaConversacion>();
  const llamadas = {
    abrir: 0,
    registrar: 0,
    devolver: [] as string[],
    terminar: [] as string[],
  };

  const repo: ChatRepo = {
    async abrir(topeDiario, ahora) {
      llamadas.abrir++;
      const hoy = diaChihuahua(ahora);
      const abiertasHoy = [...filas.values()].filter((f) => diaChihuahua(f.creadoEn) === hoy);
      if (abiertasHoy.length >= topeDiario) return { resultado: 'tope_alcanzado' };
      const id = crypto.randomUUID();
      filas.set(id, {
        id,
        chatIdRetell: null,
        mensajesUsados: 0,
        terminadaEn: null,
        creadoEn: ahora,
      });
      return { resultado: 'abierta', id };
    },

    async asociarChatRetell(id, chatIdRetell) {
      const fila = filas.get(id);
      if (!fila || fila.terminadaEn || fila.chatIdRetell !== null) return false;
      fila.chatIdRetell = chatIdRetell;
      return true;
    },

    async registrarMensaje(id, limite) {
      llamadas.registrar++;
      const fila = filas.get(id);
      if (!fila) return { resultado: 'no_encontrada' };
      if (fila.terminadaEn) return { resultado: 'terminada' };
      if (fila.chatIdRetell === null) return { resultado: 'no_encontrada' };
      if (fila.mensajesUsados >= limite) return { resultado: 'limite_alcanzado' };
      fila.mensajesUsados++;
      return {
        resultado: 'registrado',
        mensajesUsados: fila.mensajesUsados,
        chatIdRetell: fila.chatIdRetell,
      };
    },

    async devolverMensaje(id) {
      llamadas.devolver.push(id);
      const fila = filas.get(id);
      if (!fila) return null;
      fila.mensajesUsados = Math.max(0, fila.mensajesUsados - 1);
      return fila.mensajesUsados;
    },

    async terminar(id, ahora) {
      llamadas.terminar.push(id);
      const fila = filas.get(id);
      if (!fila || fila.terminadaEn) return false;
      fila.terminadaEn = ahora;
      return true;
    },
  };

  return { repo, filas, llamadas };
}

/** Mensaje de Retell para los tests. */
export const mensajeRetell = (
  rol: string,
  texto: string | null,
  id: string | null = `msg_${crypto.randomUUID()}`,
  creadoEnMs: number | null = 1_791_000_000_000,
): MensajeRetell => ({ rol, id, texto, creadoEnMs });

/** Mensajes de herramientas que Retell mezcla con los del agente y que nunca deben salir. */
export const mensajesDeHerramientas = [
  mensajeRetell('tool_call_invocation', '{"name":"cotizar_pedido"}'),
  mensajeRetell('tool_call_result', '{"ok":true,"totalCentavos":40300}'),
  mensajeRetell('node_transition', null),
  mensajeRetell('state_transition', null),
  mensajeRetell('injected', 'instrucción interna'),
  mensajeRetell('sms', 'sms interno'),
  mensajeRetell('user', 'eco del cliente'),
];

type Respuestas = {
  crearChat: () => ResultadoRetell<{ chatId: string; estado: string; mensajes: MensajeRetell[] }>;
  enviarMensaje: () => ResultadoRetell<{ mensajes: MensajeRetell[] }>;
  consultarEstado: () => ResultadoRetell<{ estado: string }>;
};

/**
 * Retell falso: anota cada llamada y responde lo que diga `respuestas` (los tests la cambian).
 * Por defecto todo sale bien. Los `chat_id` llevan `CHAT_SECRETO` para buscarlos en respuestas y logs.
 */
export function crearRetellFalso() {
  let contador = 0;
  const llamadas = {
    crearChat: [] as string[],
    enviarMensaje: [] as { chatId: string; texto: string }[],
    consultarEstado: [] as string[],
  };
  const respuestas: Respuestas = {
    crearChat: () => ({
      ok: true,
      datos: {
        chatId: `CHAT_SECRETO_${++contador}`,
        estado: 'ongoing',
        mensajes: [mensajeRetell('agent', '¡Hola! ¿Qué se te antoja hoy?')],
      },
    }),
    enviarMensaje: () => ({
      ok: true,
      datos: { mensajes: [mensajeRetell('agent', 'Claro, ¿algo más?')] },
    }),
    consultarEstado: () => ({ ok: true, datos: { estado: 'ongoing' } }),
  };

  const retell: ClienteRetell = {
    async crearChat(agentId) {
      llamadas.crearChat.push(agentId);
      return respuestas.crearChat();
    },
    async enviarMensaje(chatId, texto) {
      llamadas.enviarMensaje.push({ chatId, texto });
      return respuestas.enviarMensaje();
    },
    async consultarEstado(chatId) {
      llamadas.consultarEstado.push(chatId);
      return respuestas.consultarEstado();
    },
  };

  return { retell, llamadas, respuestas };
}
