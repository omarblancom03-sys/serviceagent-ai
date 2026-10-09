/**
 * Contrato de POST /pedidos/cotizar (US-07-P1 backend ↔ US-07-P2 agente).
 *
 * Es la fuente única del contrato: cualquier cambio entra por PR y se avisa a
 * quien tenga la otra parte.
 *
 * Reglas que respeta:
 * - Todo monto va en centavos (integer). El agente nunca calcula ni convierte:
 *   recibe los textos ya formateados (`...Texto`) y solo los lee.
 * - Los nombres de la petición llegan tal como los dijo el cliente. El SERVICIO
 *   los normaliza (mayúsculas, acentos, plurales y palabras de relleno como
 *   "la de" o "una orden de") y los resuelve contra el menú (platillo,
 *   variante_producto, sinonimo_producto, extra); el esquema no lo hace.
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

/**
 * `null` y un texto vacío o de solo espacios valen como "no vino": el modelo a
 * veces los manda en lugar de omitir el campo, y no son un cuerpo mal formado.
 */
const comoAusente = (valor: unknown) =>
  valor === null || (typeof valor === 'string' && valor.trim() === '') ? undefined : valor;

/** Campo opcional de la petición que acepta `null` y `""` como si no hubiera venido. */
const opcional = <T extends z.ZodType>(schema: T) => z.preprocess(comoAusente, schema.optional());

/** Lista opcional de la petición: si no vino (o vino `null` o `""`), vale `[]`. */
const listaOpcional = <T extends z.ZodType>(item: T, maximo: number) =>
  z.preprocess(comoAusente, z.array(item).max(maximo).default([]));

// ─── Petición ───────────────────────────────────────────────────────────────

/*
 * Los objetos de la petición son estrictos (`z.strictObject`): una llave mal
 * escrita (p. ej. `extrasSuelto`) es un cuerpo mal formado y responde 400, en
 * lugar de descartarse en silencio y cotizar un pedido incompleto.
 */

/**
 * Extra pedido para un platillo. Si no existe o no está ligado a ese platillo
 * en platillo_extra → aclaración `extra_no_permitido` con `detalle` = el extra.
 */
export const ExtraPedidoSchema = z.strictObject({
  extra: TextoClienteSchema,
  /**
   * Cantidad POR UNIDAD del platillo. "Dos T-Bone con espuelas"
   * → cantidad 2 del platillo, extra con cantidad 1 (cada T-Bone lleva las suyas).
   */
  cantidad: CantidadClienteSchema,
});

export const ProductoPedidoSchema = z.strictObject({
  /**
   * Lo ideal es que el agente mande solo las palabras del platillo ("t-bone",
   * no "dos órdenes de t-bones"), pero el servicio tolera plurales y relleno.
   * La cantidad va en `cantidad`.
   */
  producto: TextoClienteSchema,
  /**
   * Si falta y el platillo tiene varias, o si la pedida no existe →
   * `falta_variante` (ver AclaracionSchema).
   */
  variante: opcional(TextoClienteSchema),
  cantidad: CantidadClienteSchema,
  /** Solo se aceptan los de ingrediente_removible de ese platillo. */
  sinIngredientes: opcional(z.array(TextoClienteSchema).max(10)),
  /** Solo extras ligados al platillo en platillo_extra (hoy: Espuelas en 5 cortes). */
  extras: opcional(z.array(ExtraPedidoSchema).max(5)),
});

/**
 * Extras que se piden solos (Totopos, BBQ, Aguacate, Toreados): un extra es
 * "suelto" cuando no tiene filas en platillo_extra (D19). Espuelas aquí se
 * rechaza con `extra_no_permitido`; un extra suelto que no existe, con
 * `no_existe` y origen `extraSuelto`.
 */
export const ExtraSueltoPedidoSchema = ExtraPedidoSchema;

/** Argumentos de la función `cotizar_pedido`, tal como los arma el agente. */
export const CotizarPedidoArgsSchema = z
  .strictObject({
    productos: listaOpcional(ProductoPedidoSchema, 30),
    extrasSueltos: listaOpcional(ExtraSueltoPedidoSchema, 10),
  })
  .refine((args) => args.productos.length + args.extrasSueltos.length > 0, {
    message: 'El pedido debe traer al menos un producto o un extra suelto.',
  });

/**
 * Sobre que manda Retell a una custom function con "Payload: args only"
 * apagado (valor por defecto): `{ name, call, args }`. Solo se usan `name` y
 * `args`; las llaves no declaradas (como `call`) zod las descarta. A propósito
 * NO es estricto: Retell puede agregar campos al sobre sin romper la API.
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
  precioUnitarioTexto: MontoTextoSchema,
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
  precioUnitarioTexto: MontoTextoSchema,
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
  precioUnitarioTexto: MontoTextoSchema,
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
   * Qué parte falló cuando no es el producto:
   * - `extra_no_permitido`: el extra pedido (no existe o no está ligado al platillo).
   * - `ingrediente_no_removible`: el ingrediente.
   * - `falta_variante`: la variante pedida, si se pidió una que no existe.
   * - `cantidad_invalida`: la regla, p. ej. "La cantidad debe ser de 1 a 20.". Si
   *   falló un extra del platillo, la regla lo nombra: 'La cantidad de "espuelas"
   *   debe ser de 1 a 20.'.
   */
  detalle: z.string().optional(),
  /**
   * Nombres oficiales que el agente puede ofrecer: platillos en `ambiguo`,
   * variantes reales del platillo en `falta_variante` (falte o no exista la
   * pedida). Sin precios: si el cliente pregunta, el agente vuelve a cotizar.
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
