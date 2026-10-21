import type { EstadoPedido, MetodoPago, PedidoCaja } from '@serviceagent/shared';
import { ErrorApi } from './api';
import { normalizarTexto } from './menuAdmin';

/*
 * Lógica pura de la pantalla de caja (US-20): en qué grupo va cada pedido, en qué orden, cómo se
 * busca y qué dice su pago. La página solo pinta lo que sale de aquí. La recarga en vivo es la
 * misma de cocina (lib/cocina.ts → crearRecargador).
 */

export type IdGrupoCaja = 'listos' | 'en_cocina' | 'esperando_pago' | 'cerrados';

export interface GrupoCaja {
  id: IdGrupoCaja;
  titulo: string;
  pedidos: PedidoCaja[];
}

const GRUPO_DE_ESTADO: Record<EstadoPedido, IdGrupoCaja> = {
  listo: 'listos',
  en_cola: 'en_cocina',
  preparando: 'en_cocina',
  confirmado: 'esperando_pago',
  esperando_pago: 'esperando_pago',
  entregado: 'cerrados',
  cancelado: 'cerrados',
  expirado: 'cerrados',
};

/** En el orden en que se muestran: lo que caja tiene que atender primero va arriba. */
const GRUPOS: readonly { id: IdGrupoCaja; titulo: string }[] = [
  { id: 'listos', titulo: 'Listos para entregar' },
  { id: 'en_cocina', titulo: 'En cocina' },
  { id: 'esperando_pago', titulo: 'Esperando pago' },
  { id: 'cerrados', titulo: 'Entregados y cancelados' },
];

const hora = (iso: string) => new Date(iso).getTime();

/** Dentro de cada grupo: el que lleva más tiempo esperando primero; los cerrados, el más reciente. */
const ORDEN: Record<IdGrupoCaja, (a: PedidoCaja, b: PedidoCaja) => number> = {
  listos: (a, b) => hora(a.estadoDesde) - hora(b.estadoDesde) || a.folio - b.folio,
  en_cocina: (a, b) => hora(a.creadoEn) - hora(b.creadoEn) || a.folio - b.folio,
  esperando_pago: (a, b) => hora(a.creadoEn) - hora(b.creadoEn) || a.folio - b.folio,
  cerrados: (a, b) => hora(b.estadoDesde) - hora(a.estadoDesde) || b.folio - a.folio,
};

/**
 * Los pedidos agrupados por lo que caja tiene que hacer con ellos. Siempre salen "Listos para
 * entregar", "En cocina" y "Entregados y cancelados", aunque estén vacíos; "Esperando pago" solo si
 * hay alguno (por ahora solo existe con pago por transferencia).
 */
export function agruparPedidosCaja(pedidos: readonly PedidoCaja[]): GrupoCaja[] {
  return GRUPOS.map(({ id, titulo }) => ({
    id,
    titulo,
    pedidos: pedidos.filter((p) => GRUPO_DE_ESTADO[p.estado] === id).sort(ORDEN[id]),
  })).filter((g) => g.id !== 'esperando_pago' || g.pedidos.length > 0);
}

/**
 * `true` si el pedido coincide con la búsqueda: por folio ("1003" o "#1003", también solo una
 * parte) o por nombre, sin importar acentos ni mayúsculas. Una búsqueda vacía encuentra todo.
 */
export function coincideBusqueda(pedido: PedidoCaja, busqueda: string): boolean {
  const texto = normalizarTexto(busqueda);
  if (texto === '') return true;
  if (/^[0-9]+$/.test(texto)) return String(pedido.folio).includes(texto);
  return texto
    .split(' ')
    .every((palabra) => normalizarTexto(pedido.nombreCliente).includes(palabra));
}

export const ETIQUETA_ESTADO_CAJA: Record<EstadoPedido, string> = {
  confirmado: 'Confirmado',
  esperando_pago: 'Esperando pago',
  en_cola: 'En cola',
  preparando: 'Preparando',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  expirado: 'Expirado',
};

const NOMBRE_METODO: Record<MetodoPago, string> = {
  efectivo: 'efectivo',
  tarjeta: 'tarjeta',
  transferencia: 'transferencia',
};

export type TipoPago = 'pagado' | 'por_cobrar' | 'sin_cobro';

/**
 * Qué dice el pago del pedido: "Pagado con tarjeta", "Por cobrar" o, si se canceló o expiró sin
 * pagar, que ya no hay nada que cobrar.
 */
export function textoPago(pedido: PedidoCaja): { tipo: TipoPago; texto: string } {
  if (pedido.pagado) {
    const metodos = pedido.metodosPago.map((m) => NOMBRE_METODO[m]);
    const con = metodos.length > 0 ? ` con ${metodos.join(' y ')}` : '';
    return { tipo: 'pagado', texto: `Pagado${con}` };
  }
  if (pedido.estado === 'cancelado' || pedido.estado === 'expirado') {
    return { tipo: 'sin_cobro', texto: 'Sin cobrar' };
  }
  return { tipo: 'por_cobrar', texto: 'Por cobrar' };
}

/** Mensaje para caja, sin códigos técnicos. Un 401 ya cierra la sesión antes de llegar aquí. */
export function mensajeErrorCaja(error: unknown): string {
  if (error instanceof ErrorApi && error.status === 403) {
    return 'Tu usuario no tiene acceso a caja.';
  }
  return 'No se pudieron cargar los pedidos. Se vuelve a intentar sola cada 30 segundos.';
}

const formatoDia = (zona: string) =>
  new Intl.DateTimeFormat('es-MX', { timeZone: zona, day: '2-digit', month: '2-digit' });
const formatoHora = (zona: string) =>
  new Intl.DateTimeFormat('es-MX', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

/**
 * "Pidió a las 22:40" si es de hoy en la zona del restaurante, o "Pidió el 20/10 a las 22:40" si
 * es un pedido abierto de un día anterior, para que caja no lo confunda con uno de hoy.
 */
export function textoHoraPedido(creadoEn: string, ahora: Date, zona: string): string {
  const fecha = new Date(creadoEn);
  const hora = formatoHora(zona).format(fecha);
  const dia = formatoDia(zona);
  return dia.format(fecha) === dia.format(ahora)
    ? `Pidió a las ${hora}`
    : `Pidió el ${dia.format(fecha)} a las ${hora}`;
}
