import type { EstadoPedido, MetodoPago, PedidoCaja } from '@serviceagent/shared';
import { formatearPesos } from '../lib/pesos';

/*
 * Pantalla de caja (US-20). Recibe los pedidos ya leídos de la base y arma lo que caja necesita:
 * total, si ya está pagado y con qué, y cuándo entró a su estado actual. La pantalla los agrupa.
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
}

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
