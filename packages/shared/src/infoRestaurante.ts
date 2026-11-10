import { z } from 'zod';
import { CONSULTA_MAX } from './busqueda';

/*
 * Contrato de la información del restaurante (US-17, D62): custom function `info_restaurante` del
 * agente → `POST /agente/info-restaurante`. El cliente pregunta por el horario, la dirección, el
 * estacionamiento, las formas de pago o los alérgenos, y la API devuelve los textos aprobados por
 * el PO que más se parecen a la pregunta. El agente responde solo con eso.
 */

/** Cuántas entradas devuelve como máximo: una pregunta suele tocar uno o dos temas. */
export const MAX_RESULTADOS_INFO = 3;

/** Argumentos de `info_restaurante`: lo que preguntó el cliente, con sus palabras. */
export const InfoRestauranteArgsSchema = z.strictObject({
  consulta: z.string().trim().min(1).max(CONSULTA_MAX),
});

/**
 * Sobre que manda Retell con "Payload: args only" apagado: `{ name, chat, args }`. Como en
 * `buscar_menu`, `chat` no se lee y no es estricto.
 */
export const InfoRestaurantePeticionSchema = z.object({
  name: z.literal('info_restaurante'),
  args: InfoRestauranteArgsSchema,
});

/** Una entrada de la información del restaurante, tal como está en la base. */
export const ResultadoInfoSchema = z.object({
  /** Clave estable del tema: horario, direccion, estacionamiento… */
  tema: z.string().min(1),
  titulo: z.string().min(1),
  /** El texto que el agente usa para responder, sin agregar nada. */
  contenido: z.string().min(1),
});

/**
 * De la más parecida a la menos parecida. Vacía si ninguna entrada se parece lo suficiente a la
 * pregunta ("¿tienen wifi?" sin una entrada de wifi): el agente dice que no tiene ese dato.
 */
export const RespuestaInfoRestauranteSchema = z.object({
  resultados: z.array(ResultadoInfoSchema).max(MAX_RESULTADOS_INFO),
});

/** Mismo formato de error que el resto de la API. */
export const ErrorInfoSchema = z.object({
  error: z.string(),
});

export type InfoRestauranteArgs = z.infer<typeof InfoRestauranteArgsSchema>;
export type InfoRestaurantePeticion = z.infer<typeof InfoRestaurantePeticionSchema>;
export type ResultadoInfo = z.infer<typeof ResultadoInfoSchema>;
export type RespuestaInfoRestaurante = z.infer<typeof RespuestaInfoRestauranteSchema>;
