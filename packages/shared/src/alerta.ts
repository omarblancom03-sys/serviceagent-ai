/**
 * Contrato de POST /agente/escalar: custom function `transferir_a_empleado` (US-18, D59). El agente
 * la llama cuando el cliente pide hablar con alguien o cuando no puede resolver algo; la API guarda
 * una alerta "Cliente requiere atención" para caja y admin, una pendiente por conversación.
 *
 * Solo depende de zod (regla de packages/shared): nada de Hono aquí.
 */
import { z } from 'zod';
import { MAX_ID } from './menu';
import { DatoClienteInvalidoSchema, DatoClienteSchema, opcional, TelefonoSchema } from './pedido';

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Lo más largo que se guarda del motivo (check de la tabla `alertas_atencion`). */
export const MAX_CARACTERES_MOTIVO = 200;

/**
 * Lo más largo que acepta la petición. De 201 a este número no es un 400: la API responde 200 con
 * `ok: false` y la aclaración, para que el agente lo resuma. Más que esto sí es un 400 (anti-abuso).
 */
export const MAX_CARACTERES_MOTIVO_PETICION = 1000;

/**
 * Evento de la señal de Realtime cuando se crea o se atiende una alerta. Viaja por el mismo canal
 * que los pedidos (`CANAL_SENAL_PEDIDOS` de cocina.ts), con payload vacío (D47, D59).
 */
export const EVENTO_SENAL_ALERTAS = 'alerta';

// ─── Petición ───────────────────────────────────────────────────────────────

/**
 * Argumentos de `transferir_a_empleado`. Estricto: una llave de más da 400. Teléfono y nombre usan
 * las mismas piezas que `crear_pedido`: pueden faltar o venir mal y el servicio lo aclara (D32). El
 * teléfono es obligatorio para crear la alerta (el empleado tiene que poder llamar); el nombre no.
 */
export const TransferirAEmpleadoArgsSchema = z.strictObject({
  telefono: TelefonoSchema,
  nombre: DatoClienteSchema,
  /** El folio del pedido, si el cliente lo dijo. `null` o `""` valen como "no vino". */
  folio: opcional(z.number().int().positive().max(MAX_ID)),
  /** Resumen de lo que necesita el cliente, escrito por el agente. */
  motivo: z.string().trim().min(1).max(MAX_CARACTERES_MOTIVO_PETICION),
});

/**
 * Sobre que manda Retell en un agente de chat: `{ name, chat, args }`. `chat` hay que declararlo
 * (si no, zod lo descarta) y se acepta con cualquier forma: de él solo se lee `chat.chat_id`
 * (`apps/api/src/lib/chatRetell.ts`). La transcripción que trae nunca se guarda ni se devuelve.
 */
export const TransferirAEmpleadoPeticionSchema = z.object({
  name: z.literal('transferir_a_empleado'),
  chat: z.unknown().optional(),
  args: TransferirAEmpleadoArgsSchema,
});

// ─── Respuesta (siempre HTTP 200 con un cuerpo válido) ──────────────────────

/**
 * Se avisó a caja. `yaSeAviso`: esa conversación ya tiene una alerta pendiente y no se creó otra.
 * `folioNoEncontrado`: el folio no existe o no es de ese teléfono; la alerta se guardó sin folio.
 */
export const AlertaCreadaSchema = z.object({
  ok: z.literal(true),
  yaSeAviso: z.boolean(),
  folioNoEncontrado: z.boolean(),
});

/**
 * No se guardó nada. `sinConversacion`: el sobre no trajo `chat.chat_id` y no se puede cumplir "una
 * alerta pendiente por conversación". Si no, trae lo que hay que volver a pedir: `datosCliente` (teléfono o
 * nombre) y `aclaracionMotivo` (el motivo pasa de 200 caracteres), al menos una de las dos.
 */
export const AlertaNoCreadaSchema = z
  .object({
    ok: z.literal(false),
    sinConversacion: z.boolean(),
    datosCliente: z.array(DatoClienteInvalidoSchema),
    aclaracionMotivo: z.string().nullable(),
  })
  .refine((r) => r.sinConversacion || r.datosCliente.length > 0 || r.aclaracionMotivo !== null, {
    message: 'Debe traer al menos una aclaración.',
  });

export const RespuestaTransferirAEmpleadoSchema = z.discriminatedUnion('ok', [
  AlertaCreadaSchema,
  AlertaNoCreadaSchema,
]);

/** `{ error: "texto en español" }`: 400 cuerpo mal formado, 401 firma, 500 falla. */
export const ErrorAlertaSchema = z.object({
  error: z.string(),
});

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type TransferirAEmpleadoArgs = z.infer<typeof TransferirAEmpleadoArgsSchema>;
export type TransferirAEmpleadoPeticion = z.infer<typeof TransferirAEmpleadoPeticionSchema>;
export type AlertaCreada = z.infer<typeof AlertaCreadaSchema>;
export type AlertaNoCreada = z.infer<typeof AlertaNoCreadaSchema>;
export type RespuestaTransferirAEmpleado = z.infer<typeof RespuestaTransferirAEmpleadoSchema>;
export type ErrorAlerta = z.infer<typeof ErrorAlertaSchema>;
