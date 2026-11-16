import { z } from 'zod';
import { ParamsFolioCocinaSchema } from './cocina';
import { EstadoPedidoSchema } from './pedido';

/*
 * Contrato de la pantalla de caja (US-20): `GET /caja/pedidos`. Lleva lo que caja necesita para
 * cobrar y entregar: total, si ya está pagado y con qué, y los últimos dígitos del teléfono para
 * reconocer al cliente sin mostrar el número completo. Sin platillos: eso es de cocina.
 */

/** Métodos de pago (docs/negocio.md → Pagos): efectivo y tarjeta en caja, transferencia por el agente. */
export const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia'] as const;
export const MetodoPagoSchema = z.enum(METODOS_PAGO);

export const PedidoCajaSchema = z.object({
  folio: z.number().int().positive(),
  /** Para mostrarlo tal cual: "#1001". */
  folioTexto: z.string(),
  nombreCliente: z.string(),
  /** Últimos 4 dígitos del teléfono: "0101". */
  telefonoFinal: z.string().regex(/^[0-9]{4}$/),
  estado: EstadoPedidoSchema,
  /** Hora en que se creó el pedido. */
  creadoEn: z.iso.datetime({ offset: true }),
  /** Hora en que entró a su estado actual (historial, D42). Ordena cada grupo de la pantalla. */
  estadoDesde: z.iso.datetime({ offset: true }),
  totalCentavos: z.number().int().positive(),
  /** Total formateado por el backend: "$403.00". */
  totalTexto: z.string(),
  /** La suma de sus pagos cubre el total. */
  pagado: z.boolean(),
  /**
   * Lo que falta por cobrar: el total menos sus pagos, nunca negativo. Es lo que cobra el botón
   * Cobrar (US-21); la pantalla lo muestra, no lo calcula.
   */
  porCobrarCentavos: z.number().int().nonnegative(),
  /** `porCobrarCentavos` formateado por el backend: "$403.00". */
  porCobrarTexto: z.string(),
  /** Con qué se pagó, sin repetir y en el orden en que se cobró. Vacío si no hay pagos. */
  metodosPago: z.array(MetodoPagoSchema),
});

/**
 * Pedidos creados hoy (día del restaurante, America/Chihuahua) y los de días anteriores que
 * siguen abiertos, del folio menor al mayor. La pantalla los agrupa por estado.
 */
export const RespuestaPedidosCajaSchema = z.object({
  pedidos: z.array(PedidoCajaSchema),
});

export const ErrorCajaSchema = z.object({ error: z.string() });

/*
 * Cobro y entrega (US-21, D66): `POST /caja/pedidos/{folio}/cobrar` y `/entregar`. Quién cobra o
 * entrega sale de la sesión, nunca del cuerpo; cuánto se cobra lo calcula la base.
 */

/** Con qué cobra caja. La transferencia no: la registra el webhook del banco (US-25). */
export const METODOS_COBRO_CAJA = ['efectivo', 'tarjeta'] as const;
export const MetodoCobroCajaSchema = z.enum(METODOS_COBRO_CAJA);

/** Estados en los que caja puede cobrar: el pedido ya va a cocina o ya salió de ella. */
export const ESTADOS_COBRABLES_CAJA = ['en_cola', 'preparando', 'listo'] as const;

/** Folio en la ruta: la misma regla que en cocina (solo dígitos, convertido a número). */
export const ParamsFolioCajaSchema = ParamsFolioCocinaSchema;

/** Cuerpo de `/cobrar`: solo el método. Nunca un monto. */
export const CobrarPedidoPeticionSchema = z.strictObject({ metodo: MetodoCobroCajaSchema });

/** Respuesta de `/cobrar`: el pago que se registró. */
export const RespuestaCobroCajaSchema = z.object({
  folio: z.number().int().positive(),
  folioTexto: z.string(),
  metodo: MetodoCobroCajaSchema,
  /** Lo que se cobró: lo que faltaba del total, calculado por la base. */
  montoCentavos: z.number().int().positive(),
  montoTexto: z.string(),
  /** Hora del pago, puesta por Postgres (D42). */
  cobradoEn: z.iso.datetime({ offset: true }),
});

/** Respuesta de `/entregar`. */
export const RespuestaEntregaCajaSchema = z.object({
  folio: z.number().int().positive(),
  folioTexto: z.string(),
  estado: z.literal('entregado'),
  /** Hora de la entrega, puesta por Postgres (D42). */
  entregadoEn: z.iso.datetime({ offset: true }),
});

/**
 * Motivos del 409. Al cobrar: `ya_pagado` (no se cobra dos veces) o `estado_no_cobrable` (el
 * pedido no está en `ESTADOS_COBRABLES_CAJA`). Al entregar: `estado_cambio` (ya no está listo) o
 * `falta_pago` (está listo pero no se ha cobrado).
 */
export const CODIGOS_CONFLICTO_CAJA = [
  'ya_pagado',
  'estado_no_cobrable',
  'estado_cambio',
  'falta_pago',
] as const;

export const ConflictoCajaSchema = z.object({
  error: z.string(),
  codigo: z.enum(CODIGOS_CONFLICTO_CAJA),
  /** Estado en que está el pedido ahora, para que la pantalla se acomode. */
  estadoActual: EstadoPedidoSchema,
});

export type MetodoPago = z.infer<typeof MetodoPagoSchema>;
export type PedidoCaja = z.infer<typeof PedidoCajaSchema>;
export type RespuestaPedidosCaja = z.infer<typeof RespuestaPedidosCajaSchema>;
export type ErrorCaja = z.infer<typeof ErrorCajaSchema>;
export type MetodoCobroCaja = z.infer<typeof MetodoCobroCajaSchema>;
export type CobrarPedidoPeticion = z.infer<typeof CobrarPedidoPeticionSchema>;
export type RespuestaCobroCaja = z.infer<typeof RespuestaCobroCajaSchema>;
export type RespuestaEntregaCaja = z.infer<typeof RespuestaEntregaCajaSchema>;
export type CodigoConflictoCaja = (typeof CODIGOS_CONFLICTO_CAJA)[number];
export type ConflictoCaja = z.infer<typeof ConflictoCajaSchema>;
