import { z } from 'zod';

/*
 * Banco Simulado (US-24, D70). Dos contratos:
 * - Lo que la pantalla `/banco` le pide al "servidor del banco": `POST /banco-simulado/transferencias`.
 * - El aviso que ese servidor le manda al restaurante: `POST /webhooks/banco`, firmado con HMAC.
 * La conciliación del aviso con un pedido (por referencia y monto) llega en US-25.
 */

/** CLABE interbancaria: 18 dígitos. En la simulación no se revisa el dígito verificador. */
export const ClabeSchema = z.string().regex(/^\d{18}$/, 'La CLABE son 18 dígitos.');

/** Tope de una transferencia en la simulación: $100,000.00. */
export const MONTO_MAXIMO_TRANSFERENCIA_CENTAVOS = 10_000_000;

/** Monto en centavos (regla de oro 2): entero de 1 a `MONTO_MAXIMO_TRANSFERENCIA_CENTAVOS`. */
export const MontoTransferenciaSchema = z
  .number()
  .int()
  .min(1)
  .max(MONTO_MAXIMO_TRANSFERENCIA_CENTAVOS);

export const MAX_REFERENCIA_TRANSFERENCIA = 40;

/**
 * Referencia de pago: letras, números y guiones, de 1 a 40. El banco no sabe si existe: eso lo
 * decide el restaurante al conciliar (US-25).
 */
export const ReferenciaTransferenciaSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,40}$/, 'La referencia lleva solo letras, números y guiones (máximo 40).');

/** Cuerpo de `POST /banco-simulado/transferencias`. Estricto: una llave desconocida da 400. */
export const TransferenciaBancoPeticionSchema = z.strictObject({
  clabeDestino: ClabeSchema,
  montoCentavos: MontoTransferenciaSchema,
  referencia: ReferenciaTransferenciaSchema,
});

/**
 * Aviso de una transferencia recibida: cuerpo de `POST /webhooks/banco`. `idTransferencia` es
 * único por transferencia: con él se reconoce un aviso repetido (US-26).
 */
export const AvisoTransferenciaSchema = z.strictObject({
  idTransferencia: z.uuid(),
  clabeDestino: ClabeSchema,
  montoCentavos: MontoTransferenciaSchema,
  referencia: ReferenciaTransferenciaSchema,
  /** Cuándo se hizo la transferencia, según el banco. */
  fecha: z.iso.datetime({ offset: true }),
});

/** Respuesta 200 de `POST /webhooks/banco`: el aviso llegó completo y con firma válida. */
export const RespuestaWebhookBancoSchema = z.object({ recibido: z.literal(true) });

/**
 * Respuesta 201 de `POST /banco-simulado/transferencias`: la transferencia como quedó en el banco.
 * `avisoEntregado` dice si el restaurante respondió 2xx al aviso; la transferencia se hizo de todos
 * modos (el banco no la revierte).
 */
export const TransferenciaBancoSchema = AvisoTransferenciaSchema.extend({
  /** El monto formateado en pesos, solo para mostrar. */
  montoTexto: z.string(),
  avisoEntregado: z.boolean(),
});

export const ErrorBancoSchema = z.object({ error: z.string() });

export type TransferenciaBancoPeticion = z.infer<typeof TransferenciaBancoPeticionSchema>;
export type AvisoTransferencia = z.infer<typeof AvisoTransferenciaSchema>;
export type RespuestaWebhookBanco = z.infer<typeof RespuestaWebhookBancoSchema>;
export type TransferenciaBanco = z.infer<typeof TransferenciaBancoSchema>;
export type ErrorBanco = z.infer<typeof ErrorBancoSchema>;
