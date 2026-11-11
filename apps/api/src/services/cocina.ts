import {
  MAX_TERMINADOS_COCINA,
  MINUTOS_REGRESAR_SERVIDOR,
  MINUTOS_TERMINADOS_RECIENTES,
  SEGUNDOS_DESHACER_PANTALLA,
  SEGUNDOS_DESHACER_SERVIDOR,
  type ConflictoCocina,
  type EstadoCocina,
  type EstadoDeshacer,
  type EstadoPedido,
  type RenglonCocina,
  type RespuestaCambioEstadoCocina,
  type RespuestaDeshacerCocina,
  type RespuestaPedidosCocina,
  type RespuestaRegresarCocina,
  type TicketCocina,
  type TicketTerminadoCocina,
} from '@serviceagent/shared';

/*
 * Pantalla de cocina (US-10). Recibe los pedidos activos ya leídos de la base y arma los tickets:
 * solo lo que cocina necesita para preparar (sin precios ni teléfono), del más antiguo al más
 * nuevo según la hora en que entraron a la cola.
 *
 * Cambio de estado (US-11-P1, D56): Empezar, Terminado y Deshacer. Cada uno es una sola función
 * SQL atómica (D14); aquí solo se decide qué pedirle y cómo contestar.
 *
 * Terminados recientes (US-52, D63): los pedidos en 'listo' de los últimos 15 minutos vienen en la
 * misma respuesta y Regresar los devuelve a 'preparando'.
 */

/** Un pedido activo tal como lo lee el repo, antes de ordenarlo. */
export interface PedidoActivo {
  folio: number;
  nombreCliente: string;
  estado: EstadoCocina;
  /** Hora en que entró a 'en_cola' (historial, D42). */
  enColaDesde: Date;
  /** En el orden en que se pidió (`posicion`). */
  renglones: RenglonCocina[];
}

/** Un pedido terminado tal como lo lee el repo. */
export interface PedidoTerminado {
  folio: number;
  nombreCliente: string;
  enColaDesde: Date;
  /** Hora del último Terminado (historial, D42). */
  terminadoEn: Date;
  renglones: RenglonCocina[];
}

/** Lo que devuelve el repo al regresar. `motivo` es null (y `cambiadoEn` trae la hora) si se regresó. */
export interface RegresoGuardado {
  estadoActual: EstadoPedido;
  motivo: 'estado_distinto' | 'plazo_vencido' | null;
  cambiadoEn: Date | null;
}

/** Lo que devuelve el repo al cambiar el estado. `cambiadoEn` es null si el pedido no estaba en `desde`. */
export interface CambioEstadoGuardado {
  estadoActual: EstadoPedido;
  cambiadoEn: Date | null;
}

/** Lo que devuelve el repo al deshacer. `motivo` es null si se deshizo. */
export interface DeshacerGuardado {
  estadoActual: EstadoPedido;
  motivo: 'estado_distinto' | 'plazo_vencido' | null;
}

/** Interfaz de datos de cocina. La implementa `lib/repoCocina.ts` (Supabase) o un repo en memoria. */
export interface CocinaRepo {
  /** Pedidos en 'en_cola' o 'preparando', con sus renglones y extras. */
  leerPedidosActivos(): Promise<PedidoActivo[]>;
  /**
   * `leer_terminados_cocina`: pedidos en 'listo' cuyo último Terminado fue hace a lo más `minutos`
   * (reloj de Postgres), como máximo `limite`, con sus renglones y extras.
   */
  leerTerminados(consulta: { minutos: number; limite: number }): Promise<PedidoTerminado[]>;
  /** `cambiar_estado_cocina`. `null` si el folio no existe. */
  cambiarEstado(cambio: {
    folio: number;
    desde: EstadoCocina;
    hacia: EstadoDeshacer;
    idEmpleado: string;
  }): Promise<CambioEstadoGuardado | null>;
  /** `deshacer_estado_cocina`. `null` si el folio no existe. */
  deshacerEstado(deshacer: {
    folio: number;
    estado: EstadoDeshacer;
    segundosPlazo: number;
  }): Promise<DeshacerGuardado | null>;
  /** `regresar_pedido_cocina`. `null` si el folio no existe. */
  regresarPedido(regreso: {
    folio: number;
    idEmpleado: string;
    minutosPlazo: number;
  }): Promise<RegresoGuardado | null>;
}

/**
 * Tickets del más antiguo al más nuevo. Si dos entraron a la cola en el mismo instante, va primero
 * el folio menor, que se creó antes (D33).
 */
export function armarTickets(pedidos: PedidoActivo[]): TicketCocina[] {
  return [...pedidos]
    .sort((a, b) => a.enColaDesde.getTime() - b.enColaDesde.getTime() || a.folio - b.folio)
    .map((p) => ({
      folio: p.folio,
      folioTexto: `#${p.folio}`,
      nombreCliente: p.nombreCliente,
      estado: p.estado,
      enColaDesde: p.enColaDesde.toISOString(),
      renglones: p.renglones,
    }));
}

/**
 * Terminados del más reciente al más viejo según `terminadoEn`; con la misma hora, el folio mayor
 * primero (igual que `leer_terminados_cocina`). Como máximo `MAX_TERMINADOS_COCINA`.
 */
export function armarTerminados(pedidos: PedidoTerminado[]): TicketTerminadoCocina[] {
  return [...pedidos]
    .sort((a, b) => b.terminadoEn.getTime() - a.terminadoEn.getTime() || b.folio - a.folio)
    .slice(0, MAX_TERMINADOS_COCINA)
    .map((p) => ({
      folio: p.folio,
      folioTexto: `#${p.folio}`,
      nombreCliente: p.nombreCliente,
      enColaDesde: p.enColaDesde.toISOString(),
      terminadoEn: p.terminadoEn.toISOString(),
      renglones: p.renglones,
    }));
}

/**
 * Lee los pedidos activos y los terminados recientes (en paralelo) y arma la respuesta de
 * `GET /cocina/pedidos`. Los errores del repo se propagan (la ruta da 500).
 */
export async function obtenerPedidosCocina(repo: CocinaRepo): Promise<RespuestaPedidosCocina> {
  const [activos, terminados] = await Promise.all([
    repo.leerPedidosActivos(),
    repo.leerTerminados({
      minutos: MINUTOS_TERMINADOS_RECIENTES,
      limite: MAX_TERMINADOS_COCINA,
    }),
  ]);
  return { pedidos: armarTickets(activos), terminados: armarTerminados(terminados) };
}

/** Botones de cocina: Empezar (en_cola → preparando) y Terminado (preparando → listo). */
export const TRANSICIONES_COCINA = {
  empezar: { desde: 'en_cola', hacia: 'preparando' },
  terminar: { desde: 'preparando', hacia: 'listo' },
} as const satisfies Record<string, { desde: EstadoCocina; hacia: EstadoDeshacer }>;

export type AccionCocina = keyof typeof TRANSICIONES_COCINA;

/** Estado al que regresa el pedido al deshacer cada cambio. */
const ESTADO_ANTERIOR = { preparando: 'en_cola', listo: 'preparando' } as const;

/** Resultado para la ruta: la respuesta 200, el folio no existe (404) o un conflicto (409). */
export type ResultadoCocina<T> =
  | { tipo: 'ok'; respuesta: T }
  | { tipo: 'no_existe' }
  | { tipo: 'conflicto'; conflicto: ConflictoCocina };

const folioTexto = (folio: number) => `#${folio}`;

/** 409 de Empezar, Terminado y Deshacer: el pedido no está en el estado que esperaba la pantalla. */
const estadoCambio = (folio: number, estadoActual: EstadoPedido): ConflictoCocina => ({
  error: `El pedido ${folioTexto(folio)} ya no está en ese estado. Actualiza la lista.`,
  codigo: 'estado_cambio',
  estadoActual,
});

/** Empezar o Terminado. `idEmpleado` sale de la sesión. Los errores del repo se propagan (500). */
export async function cambiarEstadoCocina(
  repo: CocinaRepo,
  accion: AccionCocina,
  folio: number,
  idEmpleado: string,
): Promise<ResultadoCocina<RespuestaCambioEstadoCocina>> {
  const { desde, hacia } = TRANSICIONES_COCINA[accion];
  const guardado = await repo.cambiarEstado({ folio, desde, hacia, idEmpleado });
  if (!guardado) return { tipo: 'no_existe' };
  if (!guardado.cambiadoEn) {
    return { tipo: 'conflicto', conflicto: estadoCambio(folio, guardado.estadoActual) };
  }
  const cambiadoEn = guardado.cambiadoEn;
  return {
    tipo: 'ok',
    respuesta: {
      folio,
      folioTexto: folioTexto(folio),
      estado: hacia,
      cambiadoEn: cambiadoEn.toISOString(),
      deshacerHasta: new Date(
        cambiadoEn.getTime() + SEGUNDOS_DESHACER_PANTALLA * 1000,
      ).toISOString(),
    },
  };
}

/**
 * Deshace Empezar (`estado` = preparando) o Terminado (`estado` = listo), con el plazo del servidor
 * (`SEGUNDOS_DESHACER_SERVIDOR`). Los errores del repo se propagan (500).
 */
export async function deshacerCambioCocina(
  repo: CocinaRepo,
  folio: number,
  estado: EstadoDeshacer,
): Promise<ResultadoCocina<RespuestaDeshacerCocina>> {
  const guardado = await repo.deshacerEstado({
    folio,
    estado,
    segundosPlazo: SEGUNDOS_DESHACER_SERVIDOR,
  });
  if (!guardado) return { tipo: 'no_existe' };
  if (guardado.motivo === 'plazo_vencido') {
    return {
      tipo: 'conflicto',
      conflicto: {
        error: `Ya pasó el tiempo para deshacer el pedido ${folioTexto(folio)}.`,
        codigo: 'plazo_vencido',
        estadoActual: guardado.estadoActual,
      },
    };
  }
  if (guardado.motivo === 'estado_distinto') {
    return { tipo: 'conflicto', conflicto: estadoCambio(folio, guardado.estadoActual) };
  }
  return {
    tipo: 'ok',
    respuesta: { folio, folioTexto: folioTexto(folio), estado: ESTADO_ANTERIOR[estado] },
  };
}

/** Textos del 409 de Regresar (US-52, D63), aprobados por el PO. */
const textoYaEntregado = (folio: number) =>
  `Caja ya entregó el pedido ${folioTexto(folio)}; ya no se puede regresar a preparación.`;
const textoPlazoRegresar = (folio: number) =>
  `Ya pasaron ${MINUTOS_TERMINADOS_RECIENTES} minutos desde que se terminó el pedido ` +
  `${folioTexto(folio)}; ya no se puede regresar.`;
const textoCancelado = (folio: number) =>
  `El pedido ${folioTexto(folio)} fue cancelado; ya no se puede regresar.`;

/**
 * Regresar (listo → preparando) un pedido terminado, con el plazo del servidor
 * (`MINUTOS_REGRESAR_SERVIDOR`). `idEmpleado` sale de la sesión. Si ya no está en 'listo', el
 * mensaje depende del estado: entregado (`ya_entregado`), cancelado u otro (`estado_cambio`: otra
 * tablet ya lo regresó). Los errores del repo se propagan (500).
 */
export async function regresarPedidoCocina(
  repo: CocinaRepo,
  folio: number,
  idEmpleado: string,
): Promise<ResultadoCocina<RespuestaRegresarCocina>> {
  const guardado = await repo.regresarPedido({
    folio,
    idEmpleado,
    minutosPlazo: MINUTOS_REGRESAR_SERVIDOR,
  });
  if (!guardado) return { tipo: 'no_existe' };
  const { estadoActual, motivo, cambiadoEn } = guardado;

  if (motivo === 'plazo_vencido') {
    return {
      tipo: 'conflicto',
      conflicto: { error: textoPlazoRegresar(folio), codigo: 'plazo_vencido', estadoActual },
    };
  }
  if (motivo === 'estado_distinto') {
    if (estadoActual === 'entregado') {
      return {
        tipo: 'conflicto',
        conflicto: { error: textoYaEntregado(folio), codigo: 'ya_entregado', estadoActual },
      };
    }
    if (estadoActual === 'cancelado') {
      return {
        tipo: 'conflicto',
        conflicto: { error: textoCancelado(folio), codigo: 'estado_cambio', estadoActual },
      };
    }
    return { tipo: 'conflicto', conflicto: estadoCambio(folio, estadoActual) };
  }
  if (!cambiadoEn) {
    throw new Error(`regresar_pedido_cocina no devolvió la hora del cambio (folio ${folio}).`);
  }
  return {
    tipo: 'ok',
    respuesta: {
      folio,
      folioTexto: folioTexto(folio),
      estado: 'preparando',
      cambiadoEn: cambiadoEn.toISOString(),
    },
  };
}
