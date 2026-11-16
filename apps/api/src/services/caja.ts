import type {
  ConflictoCaja,
  EstadoPedido,
  MetodoCobroCaja,
  MetodoPago,
  PedidoCaja,
  RespuestaCobroCaja,
  RespuestaEntregaCaja,
} from '@serviceagent/shared';
import { formatearPesos } from '../lib/pesos';

/*
 * Pantalla de caja (US-20). Recibe los pedidos ya leídos de la base y arma lo que caja necesita:
 * total, si ya está pagado y con qué, y cuándo entró a su estado actual. La pantalla los agrupa.
 * Cobrar y entregar (US-21, D66) pasan por dos funciones SQL que bloquean el pedido: aquí solo se
 * traduce su resultado a la respuesta o al conflicto que ve caja.
 */

/** Zona del restaurante: el "día" de caja empieza a las 00:00 de Chihuahua, no de UTC. */
export const ZONA_HORARIA_RESTAURANTE = 'America/Chihuahua';

/**
 * Estados de un pedido que todavía no se cierra. Caja los ve aunque sean de un día anterior: un
 * pedido de las 23:50 que queda listo a las 00:10 se tiene que poder entregar.
 */
export const ESTADOS_ABIERTOS: readonly EstadoPedido[] = [
  'confirmado',
  'esperando_pago',
  'en_cola',
  'preparando',
  'listo',
];

export interface PagoLeido {
  metodo: MetodoPago;
  montoCentavos: number;
  creadoEn: Date;
}

/** Un pedido tal como lo lee el repo. */
export interface PedidoCajaLeido {
  folio: number;
  nombreCliente: string;
  /** Los 10 dígitos guardados (D32). */
  telefono: string;
  estado: EstadoPedido;
  totalCentavos: number;
  creadoEn: Date;
  /** Cada cambio de estado con su hora (D42). */
  historial: { estado: EstadoPedido; creadoEn: Date }[];
  pagos: PagoLeido[];
}

/** Interfaz de datos de caja. La implementa `lib/repoCaja.ts` (Supabase) o un repo en memoria. */
export interface CajaRepo {
  /** Pedidos creados desde `desde`, más los de antes que siguen en un estado de `ESTADOS_ABIERTOS`. */
  leerPedidosCaja(desde: Date): Promise<PedidoCajaLeido[]>;
  /**
   * Registra un pago por lo que falta del total (lo calcula la base) a nombre del empleado. `null`
   * si el folio no existe. No cobra si ya está pagado ni si el pedido no está en la cola,
   * preparándose o listo. La hora la pone la base (D42).
   */
  cobrarPedido(datos: {
    folio: number;
    metodo: MetodoCobroCaja;
    idEmpleado: string;
  }): Promise<CobroGuardado | null>;
  /**
   * Pasa el pedido de `listo` a `entregado` y guarda en el historial la hora y el empleado. `null`
   * si el folio no existe. No entrega si ya no está listo ni si falta cobrarlo.
   */
  entregarPedido(datos: { folio: number; idEmpleado: string }): Promise<EntregaGuardada | null>;
}

/** Lo que devuelve `cobrar_pedido_caja`. */
export type CobroGuardado =
  | { resultado: 'cobrado'; montoCentavos: number; cobradoEn: Date }
  | { resultado: 'ya_pagado' | 'estado_no_cobrable'; estadoActual: EstadoPedido };

/** Lo que devuelve `entregar_pedido_caja`. */
export type EntregaGuardada =
  | { resultado: 'entregado'; entregadoEn: Date }
  | { resultado: 'estado_distinto' | 'falta_pago'; estadoActual: EstadoPedido };

/** Fecha y hora de pared de `instante` en `zona`. */
function paredEn(instante: Date, zona: string) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) =>
    Number(partes.find((p) => p.type === tipo)?.value);
  return {
    anio: valor('year'),
    mes: valor('month') - 1,
    dia: valor('day'),
    hora: valor('hour'),
    minuto: valor('minute'),
    segundo: valor('second'),
  };
}

/** Desfase de `zona` respecto a UTC en `instante`: su hora de pared leída como UTC, menos el instante. */
function desfaseEn(instante: Date, zona: string): number {
  const p = paredEn(instante, zona);
  const paredComoUtc = Date.UTC(p.anio, p.mes, p.dia, p.hora, p.minuto, p.segundo);
  return paredComoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * Inicio del día (00:00) en `zona` para el instante `ahora`. El desfase se toma en la medianoche, no
 * en `ahora`: el día que cambia el horario de verano (por ejemplo, en Ciudad Juárez) la medianoche
 * y el mediodía tienen desfases distintos. Se calcula dos veces porque, para saber el desfase de la
 * medianoche, primero hay que estimar cuándo fue.
 */
export function inicioDelDia(ahora: Date, zona = ZONA_HORARIA_RESTAURANTE): Date {
  const { anio, mes, dia } = paredEn(ahora, zona);
  const medianocheComoUtc = Date.UTC(anio, mes, dia);
  const estimada = new Date(medianocheComoUtc - desfaseEn(ahora, zona));
  return new Date(medianocheComoUtc - desfaseEn(estimada, zona));
}

/**
 * Hora en que entró a su estado actual: el último registro del historial con ese estado. Si no
 * hubiera (no debería pasar: cada cambio lo guarda), la hora en que se creó.
 */
function horaDelEstado(pedido: PedidoCajaLeido): Date {
  const horas = pedido.historial
    .filter((h) => h.estado === pedido.estado)
    .map((h) => h.creadoEn.getTime());
  return new Date(horas.length > 0 ? Math.max(...horas) : pedido.creadoEn.getTime());
}

/** Métodos sin repetir, en el orden en que se cobró. */
function metodosDe(pagos: PagoLeido[]): MetodoPago[] {
  const ordenados = [...pagos].sort((a, b) => a.creadoEn.getTime() - b.creadoEn.getTime());
  return [...new Set(ordenados.map((p) => p.metodo))];
}

/** Del folio menor al mayor. "Pagado" es que la suma de los pagos cubra el total (negocio.md). */
export function armarPedidosCaja(pedidos: PedidoCajaLeido[]): PedidoCaja[] {
  return [...pedidos]
    .sort((a, b) => a.folio - b.folio)
    .map((p) => {
      const pagadoCentavos = p.pagos.reduce((suma, pago) => suma + pago.montoCentavos, 0);
      const porCobrar = Math.max(0, p.totalCentavos - pagadoCentavos);
      return {
        folio: p.folio,
        folioTexto: `#${p.folio}`,
        nombreCliente: p.nombreCliente,
        telefonoFinal: p.telefono.slice(-4),
        estado: p.estado,
        creadoEn: p.creadoEn.toISOString(),
        estadoDesde: horaDelEstado(p).toISOString(),
        totalCentavos: p.totalCentavos,
        totalTexto: formatearPesos(p.totalCentavos),
        pagado: pagadoCentavos >= p.totalCentavos,
        porCobrarCentavos: porCobrar,
        porCobrarTexto: formatearPesos(porCobrar),
        metodosPago: metodosDe(p.pagos),
      };
    });
}

/** Lee los pedidos del día y arma la lista. Los errores del repo se propagan (la ruta da 500). */
export async function obtenerPedidosCaja(
  repo: CajaRepo,
  ahora = new Date(),
): Promise<PedidoCaja[]> {
  return armarPedidosCaja(await repo.leerPedidosCaja(inicioDelDia(ahora)));
}

// Cobrar y entregar (US-21, D66)

/** Resultado para la ruta: la respuesta 200, el folio no existe (404) o un conflicto (409). */
export type ResultadoCaja<T> =
  | { tipo: 'ok'; respuesta: T }
  | { tipo: 'no_existe' }
  | { tipo: 'conflicto'; conflicto: ConflictoCaja };

const folioTexto = (folio: number) => `#${folio}`;

/** Por qué no se cobra un pedido que no está en la cola, preparándose ni listo. */
function textoNoCobrable(folio: number, estado: EstadoPedido): string {
  const pedido = `El pedido ${folioTexto(folio)}`;
  if (estado === 'cancelado') return `${pedido} está cancelado: no se cobra.`;
  if (estado === 'expirado') return `${pedido} expiró: no se cobra.`;
  if (estado === 'entregado') return `${pedido} ya se entregó.`;
  // confirmado o esperando_pago: con pago por transferencia, el pedido espera el depósito (D55).
  return `${pedido} espera una transferencia: todavía no se cobra en caja.`;
}

/** Por qué no se entrega un pedido que ya no está listo. */
function textoNoEntregable(folio: number, estado: EstadoPedido): string {
  const pedido = `El pedido ${folioTexto(folio)}`;
  if (estado === 'entregado') return `${pedido} ya se entregó.`;
  if (estado === 'cancelado') return `${pedido} está cancelado.`;
  return `${pedido} ya no está listo para entregar. Actualiza la lista.`;
}

/**
 * Botón Cobrar: registra el pago de lo que falta, en efectivo o con tarjeta. `idEmpleado` sale de
 * la sesión. Nunca recibe un monto: lo calcula la base. Los errores del repo se propagan (500).
 */
export async function cobrarPedidoCaja(
  repo: CajaRepo,
  folio: number,
  metodo: MetodoCobroCaja,
  idEmpleado: string,
): Promise<ResultadoCaja<RespuestaCobroCaja>> {
  const cobro = await repo.cobrarPedido({ folio, metodo, idEmpleado });
  if (!cobro) return { tipo: 'no_existe' };
  if (cobro.resultado !== 'cobrado') {
    const { resultado, estadoActual } = cobro;
    const error =
      resultado === 'ya_pagado'
        ? `El pedido ${folioTexto(folio)} ya está pagado.`
        : textoNoCobrable(folio, estadoActual);
    return { tipo: 'conflicto', conflicto: { error, codigo: resultado, estadoActual } };
  }
  return {
    tipo: 'ok',
    respuesta: {
      folio,
      folioTexto: folioTexto(folio),
      metodo,
      montoCentavos: cobro.montoCentavos,
      montoTexto: formatearPesos(cobro.montoCentavos),
      cobradoEn: cobro.cobradoEn.toISOString(),
    },
  };
}

/**
 * Botón Entregado: `listo` → `entregado`, solo si el pedido ya está pagado. `idEmpleado` sale de
 * la sesión. Los errores del repo se propagan (500).
 */
export async function entregarPedidoCaja(
  repo: CajaRepo,
  folio: number,
  idEmpleado: string,
): Promise<ResultadoCaja<RespuestaEntregaCaja>> {
  const entrega = await repo.entregarPedido({ folio, idEmpleado });
  if (!entrega) return { tipo: 'no_existe' };
  if (entrega.resultado !== 'entregado') {
    const { resultado, estadoActual } = entrega;
    const conflicto: ConflictoCaja =
      resultado === 'falta_pago'
        ? {
            error: `Cobra el pedido ${folioTexto(folio)} antes de entregarlo.`,
            codigo: 'falta_pago',
            estadoActual,
          }
        : { error: textoNoEntregable(folio, estadoActual), codigo: 'estado_cambio', estadoActual };
    return { tipo: 'conflicto', conflicto };
  }
  return {
    tipo: 'ok',
    respuesta: {
      folio,
      folioTexto: folioTexto(folio),
      estado: 'entregado',
      entregadoEn: entrega.entregadoEn.toISOString(),
    },
  };
}
