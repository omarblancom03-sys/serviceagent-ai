import { z } from 'zod';

/*
 * Contrato del menú público (D19, D20).
 * - activo=false: el producto no aparece en el menú.
 * - disponible=false: el producto aparece, pero agotado.
 */

const IdSchema = z.number().int().positive();

/** Monto en centavos (D7): entero y nunca negativo. */
export const CentavosSchema = z.number().int().nonnegative();

export const CategoriaSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  descripcion: z.string().nullish(),
  activo: z.boolean(),
});
export type Categoria = z.infer<typeof CategoriaSchema>;

/** Opción de un platillo con su precio (el platillo no tiene precio propio). */
export const VarianteSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  precioCentavos: CentavosSchema,
  descripcion: z.string().nullish(),
  activo: z.boolean(),
  disponible: z.boolean(),
});
export type Variante = z.infer<typeof VarianteSchema>;

/** Extra que se puede agregar a un platillo concreto (tabla `platillo_extra`). */
export const ExtraPermitidoSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  precioCentavos: CentavosSchema,
});
export type ExtraPermitido = z.infer<typeof ExtraPermitidoSchema>;

export const PlatilloSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  descripcion: z.string(),
  imagen: z.string().nullish(),
  tiempoEstimadoMin: z.number().int().positive(),
  activo: z.boolean(),
  disponible: z.boolean(),
  idCategoria: IdSchema,
  variantes: z.array(VarianteSchema).min(1),
  extrasPermitidos: z.array(ExtraPermitidoSchema),
});
export type Platillo = z.infer<typeof PlatilloSchema>;

/** Extra que se vende suelto y se cobra aparte, sin ligarse a un platillo. */
export const ExtraSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  precioCentavos: CentavosSchema,
  descripcion: z.string().nullish(),
  activo: z.boolean(),
});
export type Extra = z.infer<typeof ExtraSchema>;

export const CategoriaMenuSchema = CategoriaSchema.extend({
  platillos: z.array(PlatilloSchema),
});
export type CategoriaMenu = z.infer<typeof CategoriaMenuSchema>;

/** Respuesta de `GET /menu`. */
export const RespuestaMenuSchema = z.object({
  categorias: z.array(CategoriaMenuSchema),
  extras: z.array(ExtraSchema),
  /** Momento en que se armó la respuesta, en ISO 8601. */
  timestamp: z.iso.datetime(),
});
export type RespuestaMenu = z.infer<typeof RespuestaMenuSchema>;

/** Parámetros de `GET /menu/productos/{id}`: el id llega como texto en la URL. */
export const ParamsProductoSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export type ParamsProducto = z.infer<typeof ParamsProductoSchema>;

/** Respuesta de `GET /menu/productos/{id}`. */
export const RespuestaProductoDetalleSchema = z.object({
  platillo: PlatilloSchema,
});
export type RespuestaProductoDetalle = z.infer<typeof RespuestaProductoDetalleSchema>;

/** Respuesta de error de los endpoints del menú. */
export const ErrorMenuSchema = z.object({
  error: z.string(),
});
export type ErrorMenu = z.infer<typeof ErrorMenuSchema>;
