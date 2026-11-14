/**
 * Contrato de POST /pedidos/cancelar: custom function `cancelar_pedido` (US-14, D71). El cliente
 * cancela por el agente un pedido ya registrado, mientras no haya entrado a preparación.
 *
 * Solo depende de zod (regla de packages/shared): nada de Hono aquí.
 */
import { z } from 'zod';
import { MAX_CARACTERES_MOTIVO, MAX_CARACTERES_MOTIVO_PETICION } from './alerta';
import { MAX_ID } from './menu';
import { DatoClienteInvalidoSchema, EstadoPedidoSchema, opcional, TelefonoSchema } from './pedido';

/** Lo más largo que se guarda del motivo: el mismo tope que el de una alerta. */
export const MAX_CARACTERES_MOTIVO_CANCELACION = MAX_CARACTERES_MOTIVO;

/**
 * Por qué no se canceló. `no_encontrado`: el folio no existe o no es de ese teléfono (la misma
 * respuesta en los dos casos). `en_preparacion`: cocina ya lo empezó o ya está listo.
 * `con_pago`: ya tiene un pago. `cerrado`: ya se entregó o expiró.
 */
export const RECHAZOS_CANCELACION = [
  'no_encontrado',
  'en_preparacion',
  'con_pago',
  'cerrado',
] as const;
export const RechazoCancelacionSchema = z.enum(RECHAZOS_CANCELACION);

/**
 * Argumentos de `cancelar_pedido`. Estricto: una llave de más da 400. El teléfono usa la misma
 * pieza que `crear_pedido`: puede faltar o venir mal y el servicio lo aclara (D32). El folio puede
 * faltar (`null` o `""`) y también se aclara; si viene, es un entero positivo.
 */
export const CancelarPedidoArgsSchema = z.strictObject({
  folio: opcional(z.number().int().positive().max(MAX_ID)),
  telefono: TelefonoSchema,
  /** Por qué cancela, resumido por el agente. */
  motivo: z.string().trim().min(1).max(MAX_CARACTERES_MOTIVO_PETICION),
});

/** Sobre que manda Retell en un agente de chat. `chat` no se usa: se descarta. */
export const CancelarPedidoPeticionSchema = z.object({
  name: z.literal('cancelar_pedido'),
  args: CancelarPedidoArgsSchema,
});

/** El pedido quedó cancelado. `yaEstabaCancelado`: lo estaba desde antes; esta llamada no cambió nada. */
export const PedidoCanceladoSchema = z.object({
  ok: z.literal(true),
  folio: z.number().int().positive(),
  folioTexto: z.string(),
  estado: z.literal('cancelado'),
  yaEstabaCancelado: z.boolean(),
});

/**
 * No se canceló. Si `rechazo` es `null`, falta corregir lo que mandó el agente: `faltaFolio`,
 * `datosCliente` (el teléfono) o `aclaracionMotivo` (más de 200 caracteres). Si no, `rechazo` dice
 * por qué y `detalle` le dice al agente qué hacer; `estadoActual` es el estado del pedido (o
 * `null` si no se encontró).
 */
export const CancelacionRechazadaSchema = z.object({
  ok: z.literal(false),
  rechazo: RechazoCancelacionSchema.nullable(),
  estadoActual: EstadoPedidoSchema.nullable(),
  detalle: z.string().nullable(),
  faltaFolio: z.boolean(),
  datosCliente: z.array(DatoClienteInvalidoSchema),
  aclaracionMotivo: z.string().nullable(),
});

/** Respuesta 200 de `POST /pedidos/cancelar`: siempre un cuerpo que el agente puede leer. */
export const RespuestaCancelarPedidoSchema = z.discriminatedUnion('ok', [
  PedidoCanceladoSchema,
  CancelacionRechazadaSchema,
]);

export type RechazoCancelacion = z.infer<typeof RechazoCancelacionSchema>;
export type CancelarPedidoArgs = z.infer<typeof CancelarPedidoArgsSchema>;
export type CancelarPedidoPeticion = z.infer<typeof CancelarPedidoPeticionSchema>;
export type RespuestaCancelarPedido = z.infer<typeof RespuestaCancelarPedidoSchema>;
