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
/** Tope de la espera: con señales continuas, la lista se pide a más tardar 2 s después de la primera. */
export const ESPERA_MAXIMA_SENALES_MS = 2_000;
/** Cuánto tiempo se resalta un pedido que acaba de llegar. */
export const DURACION_RESALTE_MS = 15_000;
/** Zona del restaurante: la hora del ticket no depende de cómo esté configurada la tablet. */
export const ZONA_HORARIA_RESTAURANTE = 'America/Chihuahua';

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
  return 'No se pudieron cargar los pedidos. Se vuelve a intentar sola cada 30 segundos.';
}

/** Cuándo se vuelve a pedir la lista. La página lo crea al montarse y lo detiene al salir. */
export interface Recargador {
  /** Pide la lista. Nunca hay dos peticiones a la vez: si ya hay una, se repite al terminar. */
  recargar(): Promise<void>;
  /**
   * Llegó una señal de Realtime. Las que llegan juntas se atienden con una sola petición
   * (`ESPERA_AGRUPAR_SENALES_MS`), pero con señales continuas no se espera más de
   * `ESPERA_MAXIMA_SENALES_MS` desde la primera (D47: a lo más, recargas de más).
   */
  senal(): void;
  /** Cambió el canal. Al volver a "en vivo" pudo perderse una señal: se pone al día. */
  conexion(estado: EstadoConexion): void;
  /** Cancela lo pendiente; después ya no pide nada. */
  detener(): void;
}

export function crearRecargador(
  cargar: () => Promise<void>,
  espera = ESPERA_AGRUPAR_SENALES_MS,
  esperaMaxima = ESPERA_MAXIMA_SENALES_MS,
): Recargador {
  let cargando = false;
  let otraVez = false;
  let detenido = false;
  let agrupando: ReturnType<typeof setTimeout> | null = null;
  let primeraSenal: number | null = null;
  let estabaEnVivo = false;

  async function recargar(): Promise<void> {
    if (detenido) return;
    if (cargando) {
      otraVez = true;
      return;
    }
    cargando = true;
    try {
      do {
        otraVez = false;
        await cargar();
      } while (otraVez && !detenido);
    } finally {
      cargando = false;
    }
  }

  function cancelarAgrupado() {
    if (agrupando) clearTimeout(agrupando);
    agrupando = null;
    primeraSenal = null;
  }

  return {
    recargar,
    senal() {
      if (detenido) return;
      const ahora = Date.now();
      primeraSenal ??= ahora;
      if (agrupando) clearTimeout(agrupando);
      const restante = Math.min(espera, primeraSenal + esperaMaxima - ahora);
      agrupando = setTimeout(
        () => {
          cancelarAgrupado();
          void recargar();
        },
        Math.max(0, restante),
      );
    },
    conexion(estado) {
      if (estado === 'en_vivo' && !estabaEnVivo) void recargar();
      estabaEnVivo = estado === 'en_vivo';
    },
    detener() {
      detenido = true;
      cancelarAgrupado();
    },
  };
}
