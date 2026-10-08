/**
 * Contrato de POST /pedidos/cotizar (US-07-P1 backend ↔ US-07-P2 agente).
 *
 * Es la fuente única del contrato: cualquier cambio entra por PR y se avisa a
 * quien tenga la otra parte.
 *
 * Reglas que respeta:
 * - Todo monto va en centavos (integer). El agente nunca calcula ni convierte:
 *   recibe los textos ya formateados (`...Texto`) y solo los lee.
 * - Los nombres de la petición llegan tal como los dijo el cliente; resolverlos
 *   contra el menú (platillo, variante_producto, sinonimo_producto, extra) es
 *   trabajo del servicio, no del esquema.
 * - Solo depende de zod (regla de packages/shared): nada de Hono aquí.
 */
import { z } from 'zod';
// Los IDs de pedido usan la misma regla que los del menú (integer de 32 bits,
// hasta MAX_ID) en lugar de copiarla.
import { CentavosSchema, IdSchema } from './menu';

// ─── Constantes ─────────────────────────────────────────────────────────────

/** Límites de cantidad por renglón (criterio de US-07-P1). */
export const CANTIDAD_MINIMA = 1;
export const CANTIDAD_MAXIMA = 20;

export const TIPOS_ACLARACION = [
  'no_existe',
  'ambiguo',
  'falta_variante',
  'extra_no_permitido',
  'ingrediente_no_removible',
  'cantidad_invalida',
] as const;

// ─── Piezas reutilizables ───────────────────────────────────────────────────

/**
 * Texto dicho por el cliente. El tope de longitud es anti-abuso, no regla de
 * negocio: un texto así de largo no es un nombre de platillo.
 */
const TextoClienteSchema = z.string().trim().min(1).max(80);

/**
 * OJO: la cantidad NO se limita aquí a 1–20 ni a enteros. Si zod la rechazara,
 * la API respondería 400 y el agente no sabría qué preguntarle al cliente.
 * El criterio pide una aclaración `cantidad_invalida`, así que el rango lo
 * revisa el servicio y responde 200 con `ok: false`.
 * Regla: zod rechaza lo mal formado; el servicio, lo que no tiene sentido de negocio.
 */
const CantidadClienteSchema = z.number();

/** Monto ya formateado por el backend, p. ej. "$1,234.00". */
const MontoTextoSchema = z.string();

// ─── Petición ───────────────────────────────────────────────────────────────

export const ExtraPedidoSchema = z.object({
  extra: TextoClienteSchema,
  /**
   * Cantidad POR UNIDAD del platillo. "Dos T-Bone con espuelas"
   * → cantidad 2 del platillo, extra con cantidad 1 (cada T-Bone lleva las suyas).
   */
  cantidad: CantidadClienteSchema,
});

export const ProductoPedidoSchema = z.object({
  producto: TextoClienteSchema,
  variante: TextoClienteSchema.optional(),
  cantidad: CantidadClienteSchema,
  /** Solo se aceptan los de ingrediente_removible de ese platillo. */
  sinIngredientes: z.array(TextoClienteSchema).max(10).optional(),
  /** Solo extras ligados al platillo en platillo_extra (hoy: Espuelas en 5 cortes). */
  extras: z.array(ExtraPedidoSchema).max(5).optional(),
});

/**
 * Extras que se piden solos (Totopos, BBQ, Aguacate, Toreados): un extra es
 * "suelto" cuando no tiene filas en platillo_extra (D19). Espuelas aquí se
 * rechaza con `extra_no_permitido`.
 */
export const ExtraSueltoPedidoSchema = ExtraPedidoSchema;

/** Argumentos de la función `cotizar_pedido`, tal como los arma el agente. */
export const CotizarPedidoArgsSchema = z
  .object({
    productos: z.array(ProductoPedidoSchema).max(30).default([]),
    extrasSueltos: z.array(ExtraSueltoPedidoSchema).max(10).default([]),
  })
  .refine((args) => args.productos.length + args.extrasSueltos.length > 0, {
    message: 'El pedido debe traer al menos un producto o un extra suelto.',
  });

/**
 * Sobre que manda Retell a una custom function con "Payload: args only"
 * apagado (valor por defecto): `{ name, call, args }`. Solo se usan `name` y
 * `args`; las llaves no declaradas (como `call`) zod las descarta.
 */
export const CotizarPedidoPeticionSchema = z.object({
  name: z.literal('cotizar_pedido'),
  args: CotizarPedidoArgsSchema,
});

// ─── Respuesta exitosa ──────────────────────────────────────────────────────

export const ExtraAplicadoSchema = z.object({
  idExtra: IdSchema,
  /** Nombre oficial de la tabla extra, p. ej. "Espuelas (camarones)". */
  nombre: z.string(),
  /** Por unidad del platillo (ver ExtraPedidoSchema). */
  cantidad: z.number().int().positive(),
  precioUnitarioCentavos: CentavosSchema,
});

/**
 * Renglón de un platillo. Todo platillo tiene al menos una variante con precio
 * completo (variante_producto.precio_centavos), así que el precio sale de ahí.
 * subtotalCentavos = (precioUnitarioCentavos + Σ extra.precio × extra.cantidad) × cantidad
 */
export const RenglonPlatilloSchema = z.object({
  tipo: z.literal('platillo'),
  /** Posición en `args.productos`, para relacionar el renglón con lo pedido. */
  indice: z.number().int().nonnegative(),
  idPlatillo: IdSchema,
  /** Nombre oficial del platillo, para que el agente lo lea tal cual. */
  nombre: z.string(),
  idVariante: IdSchema,
  /**
   * Nombre de la variante, o null si el platillo solo tiene la variante "Único"
   * (así el agente no dice "Guacamole Único").
   */
  variante: z.string().nullable(),
  cantidad: z.number().int().min(CANTIDAD_MINIMA).max(CANTIDAD_MAXIMA),
  /** Nombres oficiales de los ingredientes quitados. */
  sinIngredientes: z.array(z.string()),
  extras: z.array(ExtraAplicadoSchema),
  /** Precio de la variante por unidad, SIN extras. */
  precioUnitarioCentavos: CentavosSchema,
  subtotalCentavos: CentavosSchema,
  subtotalTexto: MontoTextoSchema,
});

export const RenglonExtraSueltoSchema = z.object({
  tipo: z.literal('extra'),
  /** Posición en `args.extrasSueltos`. */
  indice: z.number().int().nonnegative(),
  idExtra: IdSchema,
  nombre: z.string(),
  cantidad: z.number().int().min(CANTIDAD_MINIMA).max(CANTIDAD_MAXIMA),
  precioUnitarioCentavos: CentavosSchema,
  subtotalCentavos: CentavosSchema,
  subtotalTexto: MontoTextoSchema,
});

export const RenglonCotizacionSchema = z.discriminatedUnion('tipo', [
  RenglonPlatilloSchema,
  RenglonExtraSueltoSchema,
]);

export const CotizacionOkSchema = z.object({
  ok: z.literal(true),
  renglones: z.array(RenglonCotizacionSchema).min(1),
  totalCentavos: CentavosSchema,
  totalTexto: MontoTextoSchema,
});

// ─── Respuesta con aclaraciones ─────────────────────────────────────────────

export const AclaracionSchema = z.object({
  tipo: z.enum(TIPOS_ACLARACION),
  /** En qué lista está lo que falló. */
  origen: z.enum(['producto', 'extraSuelto']),
  /** Posición en esa lista: distingue "la primera granero" de "la segunda". */
  indice: z.number().int().nonnegative(),
  /** Lo que dijo el cliente, tal cual. */
  producto: z.string(),
  /**
   * Qué parte falló cuando no es el producto: el extra en `extra_no_permitido`,
   * el ingrediente en `ingrediente_no_removible`, la variante si no existe.
   */
  detalle: z.string().optional(),
  /**
   * Nombres oficiales que el agente puede ofrecer: platillos en `ambiguo`,
   * variantes en `falta_variante`. Sin precios: si el cliente pregunta, el
   * agente vuelve a cotizar.
   */
  opciones: z.array(z.string()).optional(),
});

/** Si hay varias cosas por aclarar, se mandan todas en la misma respuesta. */
export const CotizacionConAclaracionesSchema = z.object({
  ok: z.literal(false),
  aclaraciones: z.array(AclaracionSchema).min(1),
});

/** Ambas respuestas usan HTTP 200: son resultados de negocio, no errores. */
export const RespuestaCotizarPedidoSchema = z.discriminatedUnion('ok', [
  CotizacionOkSchema,
  CotizacionConAclaracionesSchema,
]);

// ─── Errores ────────────────────────────────────────────────────────────────

/**
 * Mismo formato que ErrorMenuSchema: `{ error: "texto en español" }`.
 * 400: cuerpo mal formado (hook de validación). 401: firma de Retell inválida.
 */
export const ErrorPedidoSchema = z.object({
  error: z.string(),
});

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type TipoAclaracion = (typeof TIPOS_ACLARACION)[number];
export type ExtraPedido = z.infer<typeof ExtraPedidoSchema>;
export type ProductoPedido = z.infer<typeof ProductoPedidoSchema>;
export type ExtraSueltoPedido = z.infer<typeof ExtraSueltoPedidoSchema>;
export type CotizarPedidoArgs = z.infer<typeof CotizarPedidoArgsSchema>;
export type CotizarPedidoPeticion = z.infer<typeof CotizarPedidoPeticionSchema>;
export type ExtraAplicado = z.infer<typeof ExtraAplicadoSchema>;
export type RenglonPlatillo = z.infer<typeof RenglonPlatilloSchema>;
export type RenglonExtraSuelto = z.infer<typeof RenglonExtraSueltoSchema>;
export type RenglonCotizacion = z.infer<typeof RenglonCotizacionSchema>;
export type CotizacionOk = z.infer<typeof CotizacionOkSchema>;
export type Aclaracion = z.infer<typeof AclaracionSchema>;
export type CotizacionConAclaraciones = z.infer<typeof CotizacionConAclaracionesSchema>;
export type RespuestaCotizarPedido = z.infer<typeof RespuestaCotizarPedidoSchema>;
export type ErrorPedido = z.infer<typeof ErrorPedidoSchema>;
