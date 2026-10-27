import {
  ConflictoCocinaSchema,
  SEGUNDOS_DESHACER_PANTALLA,
  type EstadoCocina,
  type RespuestaCambioEstadoCocina,
  type TicketCocina,
} from '@serviceagent/shared';
import { ErrorApi } from './api';

/*
 * Lógica pura de los botones de cocina (US-11-P2, D56): Empezar, Terminado y Deshacer. Lo que esta
 * tablet cambió se guarda como "cambio local" (solo en memoria: al recargar se pierde) y se mezcla
 * con la lista de la API para decidir qué se ve. La página y el hook solo pintan lo que sale de aquí.
 */

export type AccionCocina = 'empezar' | 'terminar' | 'deshacer';

/** Estado que se pinta: los de la lista más `listo` (terminado en esta tablet, aún con Deshacer). */
export type EstadoVista = EstadoCocina | 'listo';

/** Un cambio que hizo esta tablet. */
export interface CambioLocal {
  folio: number;
  /** Copia del ticket al tocar: un pedido terminado ya no viene en la lista y se sigue mostrando. */
  ticket: TicketCocina;
  estado: EstadoVista;
  /** Hasta cuándo (reloj de la tablet, ms) se muestra el cambio aunque la lista diga otra cosa. */
  venceEn: number;
  /** Si todavía ofrece Deshacer (falso cuando ya se deshizo o falló el Deshacer). */
  deshacer: boolean;
  /**
   * Número de la última lista pedida cuando se aplicó el cambio. Una lista con número menor o igual
   * se pidió antes y puede no traerlo; solo una lista posterior manda sobre el cambio.
   */
  lista: number;
}

export type CambiosLocales = ReadonlyMap<number, CambioLocal>;

/** Lo que se pinta de cada ticket. `deshacerHasta` es `null` si no hay botón Deshacer. */
export interface TicketVista {
  ticket: TicketCocina;
  estado: EstadoVista;
  deshacerHasta: number | null;
}

const PLAZO_PANTALLA_MS = SEGUNDOS_DESHACER_PANTALLA * 1000;

export function rutaAccion(folio: number, accion: AccionCocina): string {
  return `/cocina/pedidos/${folio}/${accion}`;
}

/** Botón principal del ticket: Empezar en cola, Terminado al preparar y ninguno ya terminado. */
export function botonDe(estado: EstadoVista): 'empezar' | 'terminar' | null {
  if (estado === 'en_cola') return 'empezar';
  if (estado === 'preparando') return 'terminar';
  return null;
}

/**
 * Hasta cuándo se ofrece Deshacer, con el reloj de la tablet: la hora en que llegó la respuesta más
 * lo que la API concede (`deshacerHasta` − `cambiadoEn`), de 0 a 10 s. Así no importa si el reloj
 * de la tablet va adelantado o atrasado respecto al de Postgres.
 */
export function venceEnDe(respuesta: RespuestaCambioEstadoCocina, recibidoEn: number): number {
  const plazo = Date.parse(respuesta.deshacerHasta) - Date.parse(respuesta.cambiadoEn);
  if (Number.isNaN(plazo)) return recibidoEn;
  return recibidoEn + Math.min(PLAZO_PANTALLA_MS, Math.max(0, plazo));
}

export function registrarCambio(cambios: CambiosLocales, cambio: CambioLocal): CambiosLocales {
  return new Map(cambios).set(cambio.folio, cambio);
}

export function quitarCambio(cambios: CambiosLocales, folio: number): CambiosLocales {
  if (!cambios.has(folio)) return cambios;
  const copia = new Map(cambios);
  copia.delete(folio);
  return copia;
}

/** Si el cambio todavía manda sobre la lista: dentro de su plazo o sin una lista posterior. */
function sigueVigente(cambio: CambioLocal, ahora: number, ultimaLista: number): boolean {
  return ahora < cambio.venceEn || ultimaLista <= cambio.lista;
}

/**
 * Quita los cambios que ya vencieron y que una lista pedida después ya refleja. Devuelve el mismo
 * objeto si no quitó nada (evita pintar de nuevo).
 */
export function quitarVencidos(
  cambios: CambiosLocales,
  ahora: number,
  ultimaLista: number,
): CambiosLocales {
  const quedan = [...cambios.values()].filter((c) => sigueVigente(c, ahora, ultimaLista));
  if (quedan.length === cambios.size) return cambios;
  return new Map(quedan.map((c) => [c.folio, c]));
}

/** El siguiente `venceEn` después de `ahora`, o `null` si no queda ninguno por vencer. */
export function proximoVencimiento(cambios: CambiosLocales, ahora: number): number | null {
  const futuros = [...cambios.values()].map((c) => c.venceEn).filter((v) => v > ahora);
  return futuros.length > 0 ? Math.min(...futuros) : null;
}

/**
 * Lista de la API con los cambios de esta tablet encima. Un pedido terminado aquí sigue en su lugar
 * (orden por `enColaDesde`, igual que la API) hasta que vence su Deshacer; en las otras tablets ya
 * no viene en la lista.
 */
export function ticketsParaMostrar(
  tickets: readonly TicketCocina[],
  cambios: CambiosLocales,
  ahora: number,
  ultimaLista: number,
): TicketVista[] {
  const vistas = tickets.map((ticket) => vistaDe(ticket, cambios.get(ticket.folio)));
  const enLista = new Set(tickets.map((t) => t.folio));
  for (const cambio of cambios.values()) {
    if (!enLista.has(cambio.folio) && sigueVigente(cambio, ahora, ultimaLista)) {
      vistas.push(vistaDe(cambio.ticket, cambio));
    }
  }
  // sort es estable: con la misma hora se respeta el orden de la API.
  return vistas.sort((a, b) => Date.parse(a.ticket.enColaDesde) - Date.parse(b.ticket.enColaDesde));

  function vistaDe(ticket: TicketCocina, cambio: CambioLocal | undefined): TicketVista {
    if (!cambio || !sigueVigente(cambio, ahora, ultimaLista)) {
      return { ticket, estado: ticket.estado, deshacerHasta: null };
    }
    return {
      ticket,
      estado: cambio.estado,
      deshacerHasta: cambio.deshacer && ahora < cambio.venceEn ? cambio.venceEn : null,
    };
  }
}

/** Segundos completos que le quedan al Deshacer (redondeo hacia arriba: "1 s" hasta el final). */
export function segundosRestantes(hasta: number, ahora: number): number {
  return Math.max(0, Math.ceil((hasta - ahora) / 1000));
}

/** Mensaje para cocina, sin códigos técnicos. Un 401 ya cierra la sesión antes de llegar aquí. */
export function mensajeErrorAccion(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.status === 409) {
      const conflicto = ConflictoCocinaSchema.safeParse(error.cuerpo);
      return conflicto.success
        ? conflicto.data.error
        : 'El pedido ya no está en ese estado. Actualiza la lista.';
    }
    if (error.status === 404) return 'No encontramos ese pedido. Actualiza la lista.';
    if (error.status === 403) return 'Tu usuario no puede cambiar pedidos de cocina.';
  }
  return 'No se pudo guardar el cambio. Revisa la conexión e intenta de nuevo.';
}
