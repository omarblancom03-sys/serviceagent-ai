import { z } from 'zod';

/*
 * Contrato del menú público (D19, D20).
 * - activo=false: el producto no aparece en el menú.
 * - disponible=false: el producto aparece, pero agotado.
 */

/** Mayor valor de una columna `integer` de Postgres: los ids del menú son identity int. */
export const MAX_ID = 2_147_483_647;

export const IdSchema = z.number().int().positive().max(MAX_ID);

/** Monto en centavos (D7): entero y nunca negativo. */
export const CentavosSchema = z.number().int().nonnegative();

export const CategoriaSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  descripcion: z.string().nullable(),
  activo: z.boolean(),
});
export type Categoria = z.infer<typeof CategoriaSchema>;

/** Opción de un platillo con su precio (el platillo no tiene precio propio). */
export const VarianteSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  precioCentavos: CentavosSchema,
  descripcion: z.string().nullable(),
  activo: z.boolean(),
  disponible: z.boolean(),
});
export type Variante = z.infer<typeof VarianteSchema>;

/** Extra que se puede agregar a un platillo concreto (tabla `platillo_extra`). */
export const ExtraPermitidoSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  precioCentavos: CentavosSchema,
  disponible: z.boolean(),
});
export type ExtraPermitido = z.infer<typeof ExtraPermitidoSchema>;

/** Ingrediente que el cliente puede pedir quitar, sin cambio de precio. */
export const IngredienteRemovibleSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
});
export type IngredienteRemovible = z.infer<typeof IngredienteRemovibleSchema>;

export const PlatilloSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  descripcion: z.string(),
  imagen: z.string().nullable(),
  /** Minutos de preparación base (D18). `null` si el platillo aún no tiene tiempo cargado. */
  tiempoEstimadoMin: z.number().int().positive().nullable(),
  activo: z.boolean(),
  disponible: z.boolean(),
  idCategoria: IdSchema,
  variantes: z.array(VarianteSchema).min(1),
  extrasPermitidos: z.array(ExtraPermitidoSchema),
  ingredientesRemovibles: z.array(IngredienteRemovibleSchema),
});
export type Platillo = z.infer<typeof PlatilloSchema>;

/**
 * Extra que se vende suelto y se cobra aparte: un extra activo que no tiene ninguna fila en
 * `platillo_extra` (D19).
 */
export const ExtraSchema = z.object({
  id: IdSchema,
  nombre: z.string().min(1),
  precioCentavos: CentavosSchema,
  descripcion: z.string().nullable(),
  activo: z.boolean(),
  disponible: z.boolean(),
});
export type Extra = z.infer<typeof ExtraSchema>;

export const CategoriaMenuSchema = CategoriaSchema.extend({
  platillos: z.array(PlatilloSchema),
});
export type CategoriaMenu = z.infer<typeof CategoriaMenuSchema>;

/** Respuesta de `GET /menu`. Solo trae categorías con al menos un platillo visible. */
export const RespuestaMenuSchema = z.object({
  categorias: z.array(CategoriaMenuSchema),
  extras: z.array(ExtraSchema),
  /** Momento en que se armó la respuesta, en ISO 8601 UTC (termina en `Z`). */
  timestamp: z.iso.datetime(),
});
export type RespuestaMenu = z.infer<typeof RespuestaMenuSchema>;

/**
 * Parámetros de `GET /menu/productos/{id}`: el id llega como texto en la URL. Solo se aceptan
 * dígitos (nada de `1e3` ni `0x10`) y se convierte a número.
 */
export const ParamsProductoSchema = z.object({
  id: z
    .string()
    .regex(/^\d{1,10}$/, 'El id debe ser un entero positivo')
    .transform(Number)
    .pipe(IdSchema),
});
export type ParamsProducto = z.infer<typeof ParamsProductoSchema>;

/** Respuesta de `GET /menu/productos/{id}`. */
export const RespuestaProductoDetalleSchema = z.object({
  platillo: PlatilloSchema,
});
export type RespuestaProductoDetalle = z.infer<typeof RespuestaProductoDetalleSchema>;

/** Respuesta de error de los endpoints del menú (400, 404 y 500). */
export const ErrorMenuSchema = z.object({
  error: z.string(),
});
export type ErrorMenu = z.infer<typeof ErrorMenuSchema>;
