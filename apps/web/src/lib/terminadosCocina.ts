import {
  MAX_TERMINADOS_COCINA,
  MINUTOS_TERMINADOS_RECIENTES,
  type EstadoCocina,
  type TicketCocina,
  type TicketTerminadoCocina,
} from '@serviceagent/shared';
import { minutosDesde } from './tiempoCocina';

/*
 * Terminados recientes de cocina (US-52-P2, D63): lógica pura de la sección gris. La API manda los
 * pedidos en `listo` de los últimos 15 min (reloj de Postgres); entre una recarga y otra la tablet
 * los esconde con su propio reloj al cumplir 15 min, igual que US-13 mide los minutos (D57).
 */

/** Cuánto se queda un pedido en la sección desde su último Terminado. */
export const PLAZO_TERMINADO_MS = MINUTOS_TERMINADOS_RECIENTES * 60_000;

/** Hora (reloj de la tablet, ms) en que el terminado sale de la sección; `NaN` si la fecha no sirve. */
export function venceTerminadoEn(terminado: TicketTerminadoCocina): number {
  return Date.parse(terminado.terminadoEn) + PLAZO_TERMINADO_MS;
}

/**
 * Los que se ven: menos de 15 min desde su Terminado (a los 15 exactos ya salió), uno por folio
 * (el Terminado más reciente), del más reciente al más viejo y como máximo `MAX_TERMINADOS_COCINA`.
 */
export function terminadosVigentes(
  terminados: readonly TicketTerminadoCocina[],
  ahora: number,
): TicketTerminadoCocina[] {
  const porFolio = new Map<number, TicketTerminadoCocina>();
  for (const terminado of terminados) {
    if (!(ahora < venceTerminadoEn(terminado))) continue;
    const otro = porFolio.get(terminado.folio);
    if (!otro || Date.parse(terminado.terminadoEn) > Date.parse(otro.terminadoEn)) {
      porFolio.set(terminado.folio, terminado);
    }
  }
  return [...porFolio.values()]
    .sort((a, b) => Date.parse(b.terminadoEn) - Date.parse(a.terminadoEn))
    .slice(0, MAX_TERMINADOS_COCINA);
}

/** El siguiente momento en que sale un terminado, o `null` si no queda ninguno por salir. */
export function proximoVencimientoTerminado(
  terminados: readonly TicketTerminadoCocina[],
  ahora: number,
): number | null {
  const futuros = terminados.map(venceTerminadoEn).filter((v) => v > ahora);
  return futuros.length > 0 ? Math.min(...futuros) : null;
}

/** "hace menos de 1 min" o "hace N min" desde el Terminado. */
export function textoHace(terminadoEn: string, ahora: number): string {
  const minutos = minutosDesde(terminadoEn, ahora);
  return minutos < 1 ? 'hace menos de 1 min' : `hace ${minutos} min`;
}

/** El ticket que se acaba de terminar en esta tablet, como lo mandaría la API en `terminados`. */
export function comoTerminado(ticket: TicketCocina, terminadoEn: string): TicketTerminadoCocina {
  // Se separa `estado` solo para no copiarlo.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { estado: _estado, ...resto } = ticket;
  return { ...resto, terminadoEn };
}

/** Un terminado que vuelve a la cuadrícula (Regresar), con su `enColaDesde` de siempre. */
export function comoTicket(terminado: TicketTerminadoCocina, estado: EstadoCocina): TicketCocina {
  // Se separa `terminadoEn` solo para no copiarlo.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { terminadoEn: _terminadoEn, ...resto } = terminado;
  return { ...resto, estado };
}
