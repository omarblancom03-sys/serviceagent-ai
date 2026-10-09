/**
 * Contrato del chat web (US-09-P1 contrato ↔ US-09-P2 endpoint y web).
 *
 * La web no habla con Retell: habla con nuestra API, que hace de proxy (D21). La llave de
 * Retell vive solo en el servidor y al navegador solo llega el texto de los mensajes del
 * agente: nunca invocaciones ni resultados de herramientas ni datos técnicos de Retell.
 *
 * - Los esquemas de petición son estrictos: una llave desconocida da 400.
 * - Los de respuesta no: así un campo nuevo de la API no rompe a una web con el bundle
 *   anterior (igual que `menu.ts`). Que no lleven campos de herramientas se prueba en
 *   `apps/api/test/chat.contract.test.ts`.
 */
import { z } from 'zod';

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Mensajes que el cliente puede enviar en una conversación; el siguiente se rechaza (D21). */
export const LIMITE_MENSAJES_CLIENTE = 30;

/** Largo máximo del texto de un mensaje del cliente, ya sin espacios al inicio y al final. */
export const MAX_CARACTERES_MENSAJE = 500;

export const CODIGOS_ERROR_CHAT = [
  'peticion_invalida',
  'conversacion_no_encontrada',
  'conversacion_terminada',
  'limite_alcanzado',
  'servicio_no_disponible',
] as const;

// ─── Identificador de la conversación ───────────────────────────────────────

/**
 * Id opaco de la conversación. La API lo usa dentro de rutas de Retell (`/end-chat/{chat_id}`),
 * así que solo admite letras, dígitos, guion y guion bajo: nada de `/`, `.`, `?`, `%` ni
 * espacios. El tope de 64 es una cota nuestra: el formato real del `chat_id` de Retell se
 * confirma con una prueba real en US-09-P2.
 */
export const IdConversacionSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'El id de la conversación no es válido');

/** Parámetros de `POST /chat/conversaciones/{id}/mensajes`. */
export const ParamsConversacionSchema = z.object({
  id: IdConversacionSchema,
});
export type ParamsConversacion = z.infer<typeof ParamsConversacionSchema>;

// ─── Peticiones ─────────────────────────────────────────────────────────────

/** Cuerpo de `POST /chat/conversaciones/{id}/mensajes`. El texto se recorta antes de medirlo. */
export const EnviarMensajePeticionSchema = z.strictObject({
  texto: z.string().trim().min(1).max(MAX_CARACTERES_MENSAJE),
});
export type EnviarMensajePeticion = z.infer<typeof EnviarMensajePeticionSchema>;

// ─── Respuestas ─────────────────────────────────────────────────────────────

/** Mensaje del agente tal como lo ve el cliente: solo texto, sin rol ni herramientas. */
export const MensajeAgenteSchema = z.object({
  id: z.string().min(1),
  texto: z.string(),
  /** Momento en que el agente escribió el mensaje, en ISO 8601 UTC (termina en `Z`). */
  creadoEn: z.iso.datetime(),
});
export type MensajeAgente = z.infer<typeof MensajeAgenteSchema>;

const MensajesUsadosSchema = z.number().int().nonnegative();
const LimiteMensajesSchema = z.number().int().positive();
const usadosDentroDelLimite = (r: { mensajesUsados: number; limiteMensajes: number }) =>
  r.mensajesUsados <= r.limiteMensajes;
const ERROR_USADOS = 'mensajesUsados no puede pasar de limiteMensajes';

/**
 * Respuesta 201 de `POST /chat/conversaciones`. `mensajes` trae lo que el agente escribió al
 * abrir y puede venir vacío. `mensajesUsados` empieza en 0.
 */
export const RespuestaIniciarConversacionSchema = z
  .object({
    conversacionId: IdConversacionSchema,
    mensajes: z.array(MensajeAgenteSchema),
    mensajesUsados: MensajesUsadosSchema,
    limiteMensajes: LimiteMensajesSchema,
  })
  .refine(usadosDentroDelLimite, ERROR_USADOS);
export type RespuestaIniciarConversacion = z.infer<typeof RespuestaIniciarConversacionSchema>;

/**
 * Respuesta 200 de `POST /chat/conversaciones/{id}/mensajes`: solo los mensajes NUEVOS del
 * agente (no repite el del cliente ni los anteriores) y el conteo ya con este mensaje.
 */
export const RespuestaEnviarMensajeSchema = z
  .object({
    mensajes: z.array(MensajeAgenteSchema),
    mensajesUsados: MensajesUsadosSchema,
    limiteMensajes: LimiteMensajesSchema,
  })
  .refine(usadosDentroDelLimite, ERROR_USADOS);
export type RespuestaEnviarMensaje = z.infer<typeof RespuestaEnviarMensajeSchema>;

/**
 * Error de los endpoints del chat. `error` es un texto en español para mostrar al cliente, sin
 * detalles técnicos; la web decide qué hacer según `codigo`:
 * - `peticion_invalida` (400): texto vacío o de más de 500 caracteres, cuerpo o id mal formado.
 * - `conversacion_no_encontrada` (404): id bien formado que no existe.
 * - `conversacion_terminada` (409): el chat cerró; la web ofrece iniciar otro.
 * - `limite_alcanzado` (429): ya se enviaron `LIMITE_MENSAJES_CLIENTE` mensajes.
 * - `servicio_no_disponible` (503): Retell falló, tardó o no está configurado.
 */
export const ErrorChatSchema = z.object({
  error: z.string().min(1),
  codigo: z.enum(CODIGOS_ERROR_CHAT),
});
export type ErrorChat = z.infer<typeof ErrorChatSchema>;
