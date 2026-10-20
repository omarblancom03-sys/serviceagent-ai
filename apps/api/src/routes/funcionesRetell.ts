import type { z } from 'zod';

/* Piezas comunes de las rutas que llama Retell como custom functions (pedidos, agente). */

export const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

export const FIRMA_RETELL =
  'Solo para Retell: exige `X-Retell-Signature` (firma del cuerpo con `RETELL_API_KEY`). ';

/**
 * Texto del 400: mismo formato de error que el resto de la API. Nombra los campos que fallaron
 * (sin sus valores), para que el agente pueda corregir la llamada. Con una llave que no existe, zod
 * pone la ruta en el padre y la llave en `keys`: se nombra "args.totalCentavos", no "args".
 */
export function errorDeFormato(
  funcion: string,
  issues: { code: string; path: PropertyKey[]; keys?: string[] }[],
) {
  const campos = [
    ...new Set(
      issues.flatMap((i) =>
        i.code === 'unrecognized_keys' && i.keys
          ? i.keys.map((llave) => [...i.path, llave].join('.'))
          : [i.path.join('.') || 'cuerpo'],
      ),
    ),
  ].slice(0, 5);
  return {
    error: `La petición de ${funcion} no tiene el formato esperado. Revisa: ${campos.join(', ')}.`,
  };
}
