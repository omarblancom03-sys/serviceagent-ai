import { z } from 'zod';
import { CentavosSchema, IdSchema } from './menu';
import { MontoTextoSchema } from './pedido';

/*
 * Contrato de la búsqueda semántica del menú (US-16, D50): custom function `buscar_menu` del
 * agente → `POST /agente/buscar-menu`. El cliente describe lo que quiere con sus palabras
 * ("algo picoso con camarones") y la API devuelve los platillos más parecidos, con precio y
 * disponibilidad leídos de la base en ese momento.
 */

/** Largo máximo de la consulta: una frase del cliente, no un párrafo. */
export const CONSULTA_MAX = 200;

/** Cuántos platillos devuelve como máximo (criterio de US-16: de 3 a 5). */
export const MAX_RESULTADOS_BUSQUEDA = 5;

/** Argumentos de `buscar_menu`: lo que el cliente describió, con sus palabras. */
export const BuscarMenuArgsSchema = z.strictObject({
  consulta: z.string().trim().min(1).max(CONSULTA_MAX),
});

/**
 * Sobre que manda Retell con "Payload: args only" apagado: `{ name, call, args }`. Como en
 * `cotizar_pedido`, `call` no se lee y no es estricto: Retell puede agregar campos.
 */
export const BuscarMenuPeticionSchema = z.object({
  name: z.literal('buscar_menu'),
  args: BuscarMenuArgsSchema,
});

/**
 * Un precio del platillo. `presentacion` es el nombre de la variante ("Vaso 500 ml"), o `null` si
 * el platillo tiene una sola presentación (la variante "Único", que el agente no debe nombrar).
 */
export const PrecioBusquedaSchema = z.object({
  presentacion: z.string().min(1).nullable(),
  precioCentavos: CentavosSchema,
  /** Para leerlo tal cual: "$149.00". */
  precioTexto: MontoTextoSchema,
  disponible: z.boolean(),
});

/** Un platillo encontrado, tal como está en el menú en este momento (solo lo visible, D19). */
export const ResultadoBusquedaSchema = z.object({
  idPlatillo: IdSchema,
  /** Nombre oficial: es el que el agente manda después a `cotizar_pedido`. */
  nombre: z.string().min(1),
  categoria: z.string().min(1),
  descripcion: z.string(),
  /** D20: hoy siempre `true`; con inventario (v8) puede salir agotado. */
  disponible: z.boolean(),
  precios: z.array(PrecioBusquedaSchema).min(1),
});

/**
 * Del más parecido al menos parecido. Vacía si nada del menú se parece lo suficiente a la
 * consulta ("sushi"): el agente dice que no lo encontró, nunca inventa.
 */
export const RespuestaBuscarMenuSchema = z.object({
  resultados: z.array(ResultadoBusquedaSchema).max(MAX_RESULTADOS_BUSQUEDA),
});

/** Mismo formato de error que el resto de la API. */
export const ErrorBusquedaSchema = z.object({
  error: z.string(),
});

export type BuscarMenuArgs = z.infer<typeof BuscarMenuArgsSchema>;
export type BuscarMenuPeticion = z.infer<typeof BuscarMenuPeticionSchema>;
export type PrecioBusqueda = z.infer<typeof PrecioBusquedaSchema>;
export type ResultadoBusqueda = z.infer<typeof ResultadoBusquedaSchema>;
export type RespuestaBuscarMenu = z.infer<typeof RespuestaBuscarMenuSchema>;
