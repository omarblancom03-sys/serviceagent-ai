import { z } from 'zod';
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

export type MetodoPago = z.infer<typeof MetodoPagoSchema>;
export type PedidoCaja = z.infer<typeof PedidoCajaSchema>;
export type RespuestaPedidosCaja = z.infer<typeof RespuestaPedidosCajaSchema>;
export type ErrorCaja = z.infer<typeof ErrorCajaSchema>;
