import {
  ConflictoCocinaSchema,
  SEGUNDOS_DESHACER_PANTALLA,
  type EstadoCocina,
  type RespuestaCambioEstadoCocina,
  type RespuestaPedidosCocina,
  type TicketCocina,
  type TicketTerminadoCocina,
} from '@serviceagent/shared';
import { ErrorApi } from './api';
import { comoTerminado, comoTicket } from './terminadosCocina';

/*
 * Lógica pura de los botones de cocina (US-11-P2, D56; US-52-P2, D63): Empezar con Deshacer 10 s,
 * Terminado (sin Deshacer: el pedido baja a "Terminados recientes") y Regresar. Lo que esta tablet
 * cambió se guarda como "cambio local" (solo en memoria: al recargar se pierde) y se mezcla con la
 * lista de la API para decidir qué se ve. La página y el hook solo pintan lo que sale de aquí.
 */

export type AccionCocina = 'empezar' | 'terminar' | 'deshacer' | 'regresar';

/** Estado de un cambio local: los de la cuadrícula más `listo` (terminado en esta tablet). */
export type EstadoCambio = EstadoCocina | 'listo';

/** Un cambio que hizo esta tablet. */
export interface CambioLocal {
  folio: number;
  /** Copia del ticket al tocar: se sigue mostrando aunque la lista todavía no lo traiga así. */
  ticket: TicketCocina;
  estado: EstadoCambio;
  /** Con `listo`: hora del Terminado (`cambiadoEn` de la API), de donde cuentan los 15 min. */
  terminadoEn: string | null;
  /** Hasta cuándo (reloj de la tablet, ms) se muestra el cambio aunque la lista diga otra cosa. */
  venceEn: number;
  /** Si todavía ofrece Deshacer (solo tras Empezar; falso cuando ya se deshizo o falló). */
  deshacer: boolean;
  /**
   * Número de la última lista pedida cuando se aplicó el cambio. Una lista con número menor o igual
   * se pidió antes y puede no traerlo; solo una lista posterior manda sobre el cambio. Mientras se
   * guarda un Deshacer vale `Infinity`, para que el ticket no se vaya a media petición.
   */
  lista: number;
}

export type CambiosLocales = ReadonlyMap<number, CambioLocal>;

/** Lo que se pinta de cada ticket de la cuadrícula. `deshacerHasta` es `null` si no hay Deshacer. */
export interface TicketVista {
  ticket: TicketCocina;
  estado: EstadoCocina;
  deshacerHasta: number | null;
}

/**
 * La pantalla completa: la cuadrícula y los terminados recientes con los cambios de esta tablet
 * encima. Los terminados van sin el corte de 15 min ni el máximo: los aplica la sección con su
 * reloj (`terminadosVigentes`).
 */
export interface VistaCocina {
  activos: TicketVista[];
  terminados: TicketTerminadoCocina[];
}

const PLAZO_PANTALLA_MS = SEGUNDOS_DESHACER_PANTALLA * 1000;

export function rutaAccion(folio: number, accion: AccionCocina): string {
  return `/cocina/pedidos/${folio}/${accion}`;
}

/** Botón principal del ticket: Empezar en cola y Terminado al preparar. */
export function botonDe(estado: EstadoCocina): 'empezar' | 'terminar' {
  return estado === 'en_cola' ? 'empezar' : 'terminar';
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
 * Lista de la API con los cambios de esta tablet encima. Lo terminado aquí sale de la cuadrícula y
 * entra a los terminados al instante; lo regresado aquí hace lo contrario y vuelve a su lugar en la
 * cuadrícula (orden por `enColaDesde`, igual que la API). Las otras tablets lo ven en su siguiente
 * recarga.
 */
export function vistaCocina(
  lista: RespuestaPedidosCocina,
  cambios: CambiosLocales,
  ahora: number,
  ultimaLista: number,
): VistaCocina {
  const vigentes = new Map(
    [...cambios.values()]
      .filter((c) => sigueVigente(c, ahora, ultimaLista))
      .map((c) => [c.folio, c]),
  );

  const activos: TicketVista[] = [];
  const enLista = new Set<number>();
  for (const ticket of lista.pedidos) {
    enLista.add(ticket.folio);
    const cambio = vigentes.get(ticket.folio);
    if (!cambio) {
      activos.push({ ticket, estado: ticket.estado, deshacerHasta: null });
      continue;
    }
    const vista = vistaDe(cambio, ticket);
    if (vista) activos.push(vista);
  }
  // Un terminado con un cambio local que no es `listo` lo regresó esta tablet: va en la cuadrícula.
  const terminados = lista.terminados.filter(
    (t) => (vigentes.get(t.folio)?.estado ?? 'listo') === 'listo',
  );

  for (const cambio of vigentes.values()) {
    if (cambio.estado === 'listo') {
      if (cambio.terminadoEn !== null) {
        terminados.push(comoTerminado(cambio.ticket, cambio.terminadoEn));
      }
      continue;
    }
    const vista = enLista.has(cambio.folio) ? null : vistaDe(cambio);
    if (vista) activos.push(vista);
  }

  // sort es estable: con la misma hora se respeta el orden de la API.
  activos.sort((a, b) => Date.parse(a.ticket.enColaDesde) - Date.parse(b.ticket.enColaDesde));
  return { activos, terminados };

  /** La vista del cambio en la cuadrícula; `null` si es un Terminado (va en la sección gris). */
  function vistaDe(cambio: CambioLocal, ticket = cambio.ticket): TicketVista | null {
    const { estado } = cambio;
    if (estado === 'listo') return null;
    return {
      ticket: { ...ticket, estado },
      estado,
      deshacerHasta: cambio.deshacer && ahora < cambio.venceEn ? cambio.venceEn : null,
    };
  }
}

/** Cambio local tras Regresar: el terminado vuelve a la cuadrícula en `preparando`. */
export function cambioRegresado(
  terminado: TicketTerminadoCocina,
  ahora: number,
  lista: number,
): CambioLocal {
  return {
    folio: terminado.folio,
    ticket: comoTicket(terminado, 'preparando'),
    estado: 'preparando',
    terminadoEn: null,
    venceEn: ahora,
    deshacer: false,
    lista,
  };
}

/** Segundos completos que le quedan al Deshacer (redondeo hacia arriba: "1 s" hasta el final). */
export function segundosRestantes(hasta: number, ahora: number): number {
  return Math.max(0, Math.ceil((hasta - ahora) / 1000));
}

/** Rechazo de Regresar cuando otra tablet ya lo regresó (D63). */
export const TEXTO_YA_REGRESADO = 'Otra tablet ya lo regresó';

/**
 * Mensaje para cocina, sin códigos técnicos. Un 401 ya cierra la sesión antes de llegar aquí. En un
 * 409 se muestra el texto de la API tal cual, salvo Regresar de un pedido que ya está en
 * `preparando`: lo regresó otra tablet.
 */
export function mensajeErrorAccion(error: unknown, accion?: AccionCocina): string {
  if (error instanceof ErrorApi) {
    if (error.status === 409) {
      const conflicto = ConflictoCocinaSchema.safeParse(error.cuerpo);
      if (!conflicto.success) return 'El pedido ya no está en ese estado. Actualiza la lista.';
      const { codigo, estadoActual } = conflicto.data;
      if (accion === 'regresar' && codigo === 'estado_cambio' && estadoActual === 'preparando') {
        return TEXTO_YA_REGRESADO;
      }
      return conflicto.data.error;
    }
    if (error.status === 404) return 'No encontramos ese pedido. Actualiza la lista.';
    if (error.status === 403) return 'Tu usuario no puede cambiar pedidos de cocina.';
  }
  return 'No se pudo guardar el cambio. Revisa la conexión e intenta de nuevo.';
}

/** Error de un botón, con el folio para mostrarlo fuera del ticket si este ya no está. */
export interface ErrorTicket {
  folioTexto: string;
  texto: string;
}

/**
 * Errores cuyo ticket ya no está en pantalla (por ejemplo, Regresar de uno que caja entregó): van
 * en un aviso arriba de los terminados, "#1234: <texto>", hasta que se toque Cerrar.
 */
export function erroresSinTicket(
  errores: ReadonlyMap<number, ErrorTicket>,
  enPantalla: ReadonlySet<number>,
): { folio: number; texto: string }[] {
  return [...errores]
    .filter(([folio]) => !enPantalla.has(folio))
    .map(([folio, error]) => ({ folio, texto: `${error.folioTexto}: ${error.texto}` }));
}
