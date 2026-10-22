/*
 * Tiempo de cada ticket en cocina (US-13): minutos desde que el pedido entró a la cola
 * (`enColaDesde`, hora de Postgres, D42) y cuándo se marca como atrasado. Se calcula con el reloj
 * de la tablet; la página solo pinta lo que sale de aquí.
 */

/** A partir de estos minutos en cocina, el ticket se marca como atrasado. */
export const MINUTOS_ATRASO = 20;
/** Cada cuánto se recalculan los minutos de los tickets (no llama a la API). */
export const INTERVALO_RELOJ_MS = 15_000;

const MS_POR_MINUTO = 60_000;

/**
 * Minutos completos desde `enColaDesde` hasta `ahora` (ms). Si la tablet va atrasada la resta sale
 * negativa y se muestra 0; una fecha inválida también da 0 (la API ya la valida con zod).
 */
export function minutosDesde(enColaDesde: string, ahora: number): number {
  const desde = Date.parse(enColaDesde);
  if (Number.isNaN(desde)) return 0;
  return Math.max(0, Math.floor((ahora - desde) / MS_POR_MINUTO));
}

/** Atrasado desde `umbral` minutos: a los 20 exactos ya lo está. */
export function estaAtrasado(minutos: number, umbral = MINUTOS_ATRASO): boolean {
  return minutos >= umbral;
}

/** "12 min"; desde 60, "1 h 05 min". */
export function textoTiempo(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = String(minutos % 60).padStart(2, '0');
  return `${horas} h ${resto} min`;
}

/** Clases del ticket: rojo si está atrasado y el anillo naranja mientras es nuevo. */
export function clasesTicket({ nuevo, atrasado }: { nuevo: boolean; atrasado: boolean }): string {
  const color = atrasado
    ? 'border-red-500 bg-red-50'
    : nuevo
      ? 'border-orange-400 bg-white'
      : 'border-orange-200 bg-white';
  const anillo = nuevo ? ' ring-4 ring-orange-300' : '';
  return `rounded-2xl border p-4 shadow-sm ${color}${anillo}`;
}
