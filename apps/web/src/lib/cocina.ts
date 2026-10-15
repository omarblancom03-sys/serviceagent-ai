import type { EstadoCocina, RenglonCocina, TicketCocina } from '@serviceagent/shared';
import { ErrorApi } from './api';

/*
 * Lógica pura de la pantalla de cocina (US-10): textos de cada renglón, qué pedidos son nuevos y
 * cómo se ve la conexión en vivo. La página solo pinta lo que sale de aquí.
 */

/** Respaldo por si se pierde la señal de Realtime: la lista se vuelve a pedir sola (D47). */
export const INTERVALO_REFRESCO_MS = 30_000;
/** Señales que llegan juntas (varios cambios seguidos) se atienden con una sola petición. */
export const ESPERA_AGRUPAR_SENALES_MS = 400;
/** Cuánto tiempo se resalta un pedido que acaba de llegar. */
export const DURACION_RESALTE_MS = 15_000;

export type EstadoConexion = 'conectando' | 'en_vivo' | 'reconectando' | 'sin_tiempo_real';

/** Estado del canal de Realtime (`SUBSCRIBED`, `TIMED_OUT`, `CLOSED`, `CHANNEL_ERROR`). */
export function estadoConexionDe(estadoCanal: string): EstadoConexion {
  return estadoCanal === 'SUBSCRIBED' ? 'en_vivo' : 'reconectando';
}

export const TEXTO_CONEXION: Record<EstadoConexion, string> = {
  conectando: 'Conectando…',
  en_vivo: 'En vivo',
  reconectando: 'Sin conexión en vivo: se actualiza cada 30 s',
  sin_tiempo_real: 'Se actualiza cada 30 s',
};

export const ETIQUETA_ESTADO: Record<EstadoCocina, string> = {
  en_cola: 'En cola',
  preparando: 'Preparando',
};

/**
 * Folios que no estaban en la lista anterior. En la primera carga (`anteriores` es `null`) no hay
 * nuevos: todo lo que ya estaba esperando no se resalta.
 */
export function foliosNuevos(
  anteriores: readonly TicketCocina[] | null,
  actuales: readonly TicketCocina[],
): number[] {
  if (anteriores === null) return [];
  const antes = new Set(anteriores.map((t) => t.folio));
  return actuales.filter((t) => !antes.has(t.folio)).map((t) => t.folio);
}

export interface LineaTicket {
  /** "2 × T-Bone 450 gr" o "1 × Limonada mineral (Vaso 500 ml)". */
  principal: string;
  /** "Sin cebolla asada", "+ 1 Espuelas (camarones) c/u". */
  detalles: string[];
}

/**
 * Texto de un renglón. Los extras de un platillo van por unidad: con más de una se aclara "c/u"
 * para que cocina no prepare uno solo.
 */
export function lineaDe(renglon: RenglonCocina): LineaTicket {
  if (renglon.tipo === 'extra') {
    return { principal: `${renglon.cantidad} × ${renglon.nombre}`, detalles: [] };
  }
  const variante = renglon.variante ? ` (${renglon.variante})` : '';
  const porUnidad = renglon.cantidad > 1 ? ' c/u' : '';
  return {
    principal: `${renglon.cantidad} × ${renglon.nombre}${variante}`,
    detalles: [
      ...renglon.sinIngredientes.map((ingrediente) => `Sin ${ingrediente.toLowerCase()}`),
      ...renglon.extras.map((e) => `+ ${e.cantidad} ${e.nombre}${porUnidad}`),
    ],
  };
}

/** Platillos y extras sueltos por separado: los sueltos van al final, bajo "Aparte". */
export function separarRenglones(ticket: TicketCocina): {
  platillos: LineaTicket[];
  aparte: LineaTicket[];
} {
  return {
    platillos: ticket.renglones.filter((r) => r.tipo === 'platillo').map(lineaDe),
    aparte: ticket.renglones.filter((r) => r.tipo === 'extra').map(lineaDe),
  };
}

/** Mensaje para cocina, sin códigos técnicos. Un 401 ya cierra la sesión antes de llegar aquí. */
export function mensajeErrorCocina(error: unknown): string {
  if (error instanceof ErrorApi && error.status === 403) {
    return 'Tu usuario no tiene acceso a cocina.';
  }
  return 'No se pudieron cargar los pedidos. Se vuelve a intentar sola en unos segundos.';
}
