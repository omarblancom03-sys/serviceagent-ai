import {
  LIMITE_MENSAJES_CLIENTE,
  type MensajeAgente,
  type RespuestaEnviarMensaje,
  type RespuestaIniciarConversacion,
} from '@serviceagent/shared';

/**
 * Chat web (US-09-P1): la API abre la conversación y cuenta los mensajes del cliente en
 * `conversaciones_chat` (D36) y habla con Retell (D21). Reglas de tope y de devolución: D38 y
 * D39; flujos en docs/agente.md → Chat web.
 */

/** Conversaciones nuevas al día en todo el sistema si `CHAT_TOPE_DIARIO` falta o no es válido (D38). */
export const TOPE_DIARIO_POR_DEFECTO = 3;
export const TOPE_DIARIO_MAXIMO = 100;

// Datos (Supabase en producción, memoria en los tests)

export type ResultadoAbrir = { resultado: 'abierta'; id: string } | { resultado: 'tope_alcanzado' };

export type ResultadoRegistrar =
  | { resultado: 'registrado'; mensajesUsados: number; chatIdRetell: string }
  | { resultado: 'no_encontrada' | 'terminada' | 'limite_alcanzado' };

/** Funciones atómicas de `conversaciones_chat` (supabase/migrations/*_crear_conversaciones_chat.sql). */
export interface ChatRepo {
  /** Abre una conversación si hoy (día de America/Chihuahua) no se llegó al tope. */
  abrir(topeDiario: number, ahora: Date): Promise<ResultadoAbrir>;
  /** Guarda el `chat_id` de Retell; `false` si la conversación ya terminó o ya tenía uno. */
  asociarChatRetell(id: string, chatIdRetell: string): Promise<boolean>;
  /** Cuenta un mensaje del cliente ANTES de mandarlo a Retell, sin pasar de `limite`. */
  registrarMensaje(id: string, limite: number, ahora: Date): Promise<ResultadoRegistrar>;
  /** Resta el mensaje contado; nunca baja de 0. `null` si la conversación no existe. */
  devolverMensaje(id: string): Promise<number | null>;
  /** Marca la conversación como terminada; `false` si ya lo estaba o no existe. */
  terminar(id: string, ahora: Date): Promise<boolean>;
}

// Retell

/** Mensaje de Retell ya leído, con los campos que la API puede usar. Puede ser de herramientas. */
export interface MensajeRetell {
  rol: string;
  id: string | null;
  texto: string | null;
  creadoEnMs: number | null;
}

/**
 * Por qué falló una llamada a Retell (D39):
 * - `rechazo`: 400, 401, 402, 422 o 429; Retell rechazó la petición sin procesarla.
 * - `sin_conexion`: la conexión falló antes de recibir respuesta.
 * - `timeout`: Retell tardó demasiado; pudo haber procesado y cobrado.
 * - `incierta`: 5xx, otro estado o una respuesta que no se entiende; pudo haber cobrado.
 */
export type FallaRetell = 'rechazo' | 'sin_conexion' | 'timeout' | 'incierta';

export type ResultadoRetell<T> =
  { ok: true; datos: T } | { ok: false; falla: FallaRetell; status?: number };

/** API de chat de Retell. En producción, `fetch` (lib/clienteRetell.ts); en los tests, un falso. */
export interface ClienteRetell {
  crearChat(
    agentId: string,
  ): Promise<ResultadoRetell<{ chatId: string; estado: string; mensajes: MensajeRetell[] }>>;
  enviarMensaje(
    chatId: string,
    texto: string,
  ): Promise<ResultadoRetell<{ mensajes: MensajeRetell[] }>>;
  consultarEstado(chatId: string): Promise<ResultadoRetell<{ estado: string }>>;
}

export interface DependenciasServicioChat {
  repo: ChatRepo;
  retell: ClienteRetell;
}

// Configuración

export interface ConfigChat {
  llave: string | null;
  agentId: string | null;
  topeDiario: number;
}

/** Lee la configuración del chat. Una variable vacía o solo con espacios cuenta como faltante. */
export function leerConfigChat(env: {
  RETELL_API_KEY?: string;
  RETELL_AGENT_ID?: string;
  CHAT_TOPE_DIARIO?: string;
}): ConfigChat {
  return {
    llave: valorLimpio(env.RETELL_API_KEY),
    agentId: valorLimpio(env.RETELL_AGENT_ID),
    topeDiario: leerTopeDiario(env.CHAT_TOPE_DIARIO),
  };
}

/**
 * `CHAT_TOPE_DIARIO` es opcional: si falta, está vacía, no es un entero o está fuera de 1 a
 * 100, se usa 3. Nunca queda sin tope (D38).
 */
export function leerTopeDiario(valor: string | undefined): number {
  const texto = valor?.trim() ?? '';
  if (!/^\d+$/.test(texto)) return TOPE_DIARIO_POR_DEFECTO;
  const tope = Number(texto);
  return tope >= 1 && tope <= TOPE_DIARIO_MAXIMO ? tope : TOPE_DIARIO_POR_DEFECTO;
}

function valorLimpio(valor: string | undefined): string | null {
  const limpio = valor?.trim() ?? '';
  return limpio === '' ? null : limpio;
}

// Mensajes

/**
 * Solo pasan los mensajes con `role` `agent` y texto: nunca herramientas, transiciones ni
 * datos de Retell. Si Retell no trae el id o la hora, se generan aquí.
 */
export function aMensajesAgente(mensajes: MensajeRetell[], ahora: Date): MensajeAgente[] {
  return mensajes
    .filter((m) => m.rol === 'agent' && m.texto !== null && m.texto.trim() !== '')
    .map((m) => ({
      id: m.id ?? crypto.randomUUID(),
      texto: m.texto ?? '',
      creadoEn: new Date(m.creadoEnMs ?? ahora.getTime()).toISOString(),
    }));
}

// Iniciar conversación

export type ResultadoIniciar =
  | { tipo: 'ok'; respuesta: RespuestaIniciarConversacion }
  | { tipo: 'tope_alcanzado' }
  | { tipo: 'no_disponible' };

/**
 * Abre la conversación en la base (gasta un lugar del tope) y luego el chat en Retell. Si
 * Retell falla, la conversación se termina y el lugar queda gastado (D39).
 */
export async function iniciarConversacion(
  { repo, retell }: DependenciasServicioChat,
  { agentId, topeDiario }: { agentId: string; topeDiario: number },
  ahora: Date = new Date(),
): Promise<ResultadoIniciar> {
  const abierta = await repo.abrir(topeDiario, ahora);
  if (abierta.resultado === 'tope_alcanzado') return { tipo: 'tope_alcanzado' };
  const { id } = abierta;

  try {
    const chat = await retell.crearChat(agentId);
    if (!chat.ok) {
      avisarFalla('create-chat', chat);
      await terminarSinFallar(repo, id, ahora);
      return { tipo: 'no_disponible' };
    }
    if (chat.datos.estado !== 'ongoing') {
      console.warn('chat: create-chat devolvió un chat que no está activo');
      await terminarSinFallar(repo, id, ahora);
      return { tipo: 'no_disponible' };
    }
    if (!(await repo.asociarChatRetell(id, chat.datos.chatId))) {
      console.warn('chat: no se pudo asociar el chat de Retell');
      await terminarSinFallar(repo, id, ahora);
      return { tipo: 'no_disponible' };
    }
    return {
      tipo: 'ok',
      respuesta: {
        conversacionId: id,
        mensajes: aMensajesAgente(chat.datos.mensajes, ahora),
        mensajesUsados: 0,
        limiteMensajes: LIMITE_MENSAJES_CLIENTE,
      },
    };
  } catch (error) {
    avisarError('iniciar conversación', error);
    await terminarSinFallar(repo, id, ahora);
    return { tipo: 'no_disponible' };
  }
}

// Enviar mensaje

export type ResultadoEnviar =
  | { tipo: 'ok'; respuesta: RespuestaEnviarMensaje }
  | { tipo: 'no_encontrada' | 'terminada' | 'limite_alcanzado' | 'no_disponible' };

/**
 * Cuenta el mensaje y lo manda a Retell. El mensaje contado solo se devuelve si Retell
 * claramente no lo procesó; ante timeout, 5xx o duda se queda contado (D39).
 */
export async function enviarMensaje(
  { repo, retell }: DependenciasServicioChat,
  { id, texto }: { id: string; texto: string },
  ahora: Date = new Date(),
): Promise<ResultadoEnviar> {
  const registro = await repo.registrarMensaje(id, LIMITE_MENSAJES_CLIENTE, ahora);
  if (registro.resultado !== 'registrado') return { tipo: registro.resultado };
  const { chatIdRetell, mensajesUsados } = registro;

  const respuesta = await retell.enviarMensaje(chatIdRetell, texto);
  if (respuesta.ok) {
    return {
      tipo: 'ok',
      respuesta: {
        mensajes: aMensajesAgente(respuesta.datos.mensajes, ahora),
        mensajesUsados,
        limiteMensajes: LIMITE_MENSAJES_CLIENTE,
      },
    };
  }
  avisarFalla('create-chat-completion', respuesta);

  // Un 400 o 422 puede ser un chat que Retell ya cerró (por inactividad): se pregunta.
  if (respuesta.falla === 'rechazo' && (respuesta.status === 400 || respuesta.status === 422)) {
    const estado = await retell.consultarEstado(chatIdRetell);
    if (!estado.ok) avisarFalla('get-chat', estado);
    if (estado.ok && estado.datos.estado === 'ended') {
      await terminarSinFallar(repo, id, ahora);
      await devolverSinFallar(repo, id);
      return { tipo: 'terminada' };
    }
  }

  if (respuesta.falla === 'rechazo' || respuesta.falla === 'sin_conexion') {
    await devolverSinFallar(repo, id);
  }
  return { tipo: 'no_disponible' };
}

// Apoyo. Los logs llevan solo la operación y el estado: nunca la llave, el texto ni el chat_id.

function avisarFalla(
  operacion: string,
  { falla, status }: { falla: FallaRetell; status?: number },
) {
  console.warn(`chat: Retell falló en ${operacion}`, { falla, status: status ?? null });
}

function avisarError(operacion: string, error: unknown) {
  console.error(
    `chat: error al ${operacion}`,
    error instanceof Error ? error.message : 'desconocido',
  );
}

/** Se usa mientras ya se atiende otra falla: si también falla, solo se anota. */
async function terminarSinFallar(repo: ChatRepo, id: string, ahora: Date) {
  try {
    await repo.terminar(id, ahora);
  } catch (error) {
    avisarError('terminar la conversación', error);
  }
}

async function devolverSinFallar(repo: ChatRepo, id: string) {
  try {
    await repo.devolverMensaje(id);
  } catch (error) {
    avisarError('devolver el mensaje', error);
  }
}
