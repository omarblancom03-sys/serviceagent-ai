import {
  EnviarMensajePeticionSchema,
  ErrorChatSchema,
  LIMITE_MENSAJES_CLIENTE,
  MAX_CARACTERES_MENSAJE,
  type MensajeAgente,
} from '@serviceagent/shared';
import { ErrorApi } from './api';
import { normalizarTexto } from './menuAdmin';

/**
 * Lógica pura del chat de `/pedir` (US-09-P2): estado, reducer, validación del texto y qué
 * mostrar ante cada error de la API. La pantalla solo hace las llamadas y despacha acciones.
 *
 * La conversación se crea al enviar el primer mensaje y no se guarda en el navegador (D40).
 */

export const SALUDO =
  '¡Hola! Soy el asistente de pedidos de El Granero. ¿Quieres ver el menú o hacer un pedido?';

/** Botones rápidos: envían su texto como mensaje normal. */
export const BOTONES_RAPIDOS = ['Ver menú', 'Quiero pedir'] as const;

export const MENSAJE_NO_DISPONIBLE =
  'El asistente no está disponible en este momento. Intenta de nuevo en unos minutos.';
export const MENSAJE_TOPE_DIARIO = 'El chat llegó a su límite de hoy. Intenta de nuevo mañana.';
export const MENSAJE_TERMINADA = 'Esta conversación terminó.';
export const MENSAJE_PETICION_INVALIDA = `No pudimos enviar tu mensaje. Revisa que tenga de 1 a ${MAX_CARACTERES_MENSAJE} caracteres.`;

export function mensajeLimite(limiteMensajes: number): string {
  return `Llegaste al límite de ${limiteMensajes} mensajes de esta conversación.`;
}

export type Fase = 'listo' | 'enviando' | 'error' | 'terminada' | 'limite' | 'tope_diario';

export interface Burbuja {
  id: string;
  autor: 'asistente' | 'cliente';
  texto: string;
}

export interface Aviso {
  mensaje: string;
  accion: 'reintentar' | 'iniciar_otra' | 'ninguna';
}

export interface EstadoChat {
  /** `null` hasta que `POST /chat/conversaciones` responde 201. */
  conversacionId: string | null;
  burbujas: Burbuja[];
  mensajesUsados: number;
  limiteMensajes: number;
  fase: Fase;
  /** Texto en vuelo o que falló: Reintentar lo reenvía sin agregar otra burbuja. */
  pendiente: string | null;
  aviso: Aviso | null;
  /** Para los ids locales de las burbujas del cliente. */
  siguienteId: number;
}

/** Qué hacer ante un error: la fase a la que pasa el chat y el aviso que se muestra. */
export interface FallaChat {
  fase: Exclude<Fase, 'enviando'>;
  aviso: Aviso;
}

interface Conteo {
  mensajes: MensajeAgente[];
  mensajesUsados: number;
  limiteMensajes: number;
}

export type AccionChat =
  | { tipo: 'enviar'; texto: string }
  | { tipo: 'reintentar' }
  | ({ tipo: 'conversacionCreada'; conversacionId: string } & Conteo)
  | ({ tipo: 'respuesta' } & Conteo)
  | { tipo: 'fallo'; falla: FallaChat }
  | { tipo: 'iniciarOtra' };

export function estadoInicial(): EstadoChat {
  return {
    conversacionId: null,
    burbujas: [{ id: 'saludo', autor: 'asistente', texto: SALUDO }],
    mensajesUsados: 0,
    limiteMensajes: LIMITE_MENSAJES_CLIENTE,
    fase: 'listo',
    pendiente: null,
    aviso: null,
    siguienteId: 1,
  };
}

function burbujasAgente(mensajes: MensajeAgente[]): Burbuja[] {
  return mensajes.map((m) => ({ id: m.id, autor: 'asistente', texto: m.texto }));
}

export function reducirChat(estado: EstadoChat, accion: AccionChat): EstadoChat {
  switch (accion.tipo) {
    case 'enviar':
      if (estado.fase !== 'listo') return estado;
      return {
        ...estado,
        burbujas: [
          ...estado.burbujas,
          { id: `cliente-${estado.siguienteId}`, autor: 'cliente', texto: accion.texto },
        ],
        siguienteId: estado.siguienteId + 1,
        fase: 'enviando',
        pendiente: accion.texto,
        aviso: null,
      };
    case 'reintentar':
      if (estado.fase !== 'error' || estado.pendiente === null) return estado;
      return { ...estado, fase: 'enviando', aviso: null };
    case 'conversacionCreada':
      return {
        ...estado,
        conversacionId: accion.conversacionId,
        burbujas: [...estado.burbujas, ...burbujasAgente(accion.mensajes)],
        mensajesUsados: accion.mensajesUsados,
        limiteMensajes: accion.limiteMensajes,
      };
    case 'respuesta': {
      // Al llegar al límite se avisa ya, sin esperar a que el siguiente envío dé 429.
      const lleno = accion.mensajesUsados >= accion.limiteMensajes;
      return {
        ...estado,
        burbujas: [...estado.burbujas, ...burbujasAgente(accion.mensajes)],
        mensajesUsados: accion.mensajesUsados,
        limiteMensajes: accion.limiteMensajes,
        fase: lleno ? 'limite' : 'listo',
        pendiente: null,
        aviso: lleno ? { mensaje: mensajeLimite(accion.limiteMensajes), accion: 'ninguna' } : null,
      };
    }
    case 'fallo':
      return {
        ...estado,
        fase: accion.falla.fase,
        aviso: accion.falla.aviso,
        // Solo la fase `error` puede reintentar; en las demás el texto ya no se reenvía.
        pendiente: accion.falla.fase === 'error' ? estado.pendiente : null,
        mensajesUsados:
          accion.falla.fase === 'limite' ? estado.limiteMensajes : estado.mensajesUsados,
      };
    case 'iniciarOtra':
      return estadoInicial();
  }
}

/** La caja de texto y los botones solo se usan con el chat listo. */
export function puedeEscribir(estado: EstadoChat): boolean {
  return estado.fase === 'listo';
}

/** Los botones rápidos se ocultan en cuanto el cliente envía su primer mensaje. */
export function botonesRapidosVisibles(estado: EstadoChat): boolean {
  return !estado.burbujas.some((b) => b.autor === 'cliente');
}

export type ValidacionTexto = { ok: true; texto: string } | { ok: false; mensaje: string };

/** Recorta y valida el texto con el mismo esquema que usa la API (de 1 a 500 caracteres). */
export function validarTexto(texto: string): ValidacionTexto {
  const resultado = EnviarMensajePeticionSchema.safeParse({ texto });
  if (resultado.success) return { ok: true, texto: resultado.data.texto };
  if (texto.trim().length === 0)
    return { ok: false, mensaje: 'Escribe un mensaje antes de enviar.' };
  return {
    ok: false,
    mensaje: `Tu mensaje es muy largo: el máximo es de ${MAX_CARACTERES_MENSAJE} caracteres.`,
  };
}

export type PasoChat = 'crear' | 'enviar';

/**
 * El tope diario (D38) y una falla de Retell dan el mismo 503 `servicio_no_disponible`; la API
 * los distingue solo por el texto de `error` (apps/api/src/routes/chat.ts). Además, el tope
 * solo puede ocurrir al crear la conversación. Si la API cambia ese texto, cae al 503 genérico
 * con Reintentar, que solo vuelve a dar 503. Un código propio en el contrato lo resolvería.
 */
function esTopeDiario(paso: PasoChat, error: ErrorApi, texto: string): boolean {
  return (
    paso === 'crear' && error.status === 503 && normalizarTexto(texto).includes('limite de hoy')
  );
}

/** Traduce cualquier error de la llamada a la fase y el aviso del chat, sin códigos HTTP. */
export function clasificarErrorChat(
  error: unknown,
  paso: PasoChat,
  limiteMensajes: number,
): FallaChat {
  const noDisponible: FallaChat = {
    fase: 'error',
    aviso: { mensaje: MENSAJE_NO_DISPONIBLE, accion: 'reintentar' },
  };
  // Sin conexión (fetch lanza TypeError) o respuesta que no cumple el contrato (ZodError).
  if (!(error instanceof ErrorApi)) return noDisponible;

  const cuerpo = ErrorChatSchema.safeParse(error.cuerpo);
  const codigo = cuerpo.success ? cuerpo.data.codigo : null;

  if (
    cuerpo.success &&
    codigo === 'servicio_no_disponible' &&
    esTopeDiario(paso, error, cuerpo.data.error)
  ) {
    return { fase: 'tope_diario', aviso: { mensaje: MENSAJE_TOPE_DIARIO, accion: 'ninguna' } };
  }
  if (codigo === 'conversacion_terminada' || codigo === 'conversacion_no_encontrada') {
    return { fase: 'terminada', aviso: { mensaje: MENSAJE_TERMINADA, accion: 'iniciar_otra' } };
  }
  if (codigo === 'limite_alcanzado') {
    return { fase: 'limite', aviso: { mensaje: mensajeLimite(limiteMensajes), accion: 'ninguna' } };
  }
  if (codigo === 'peticion_invalida') {
    return { fase: 'listo', aviso: { mensaje: MENSAJE_PETICION_INVALIDA, accion: 'ninguna' } };
  }
  return noDisponible;
}
