import type { ConfiguracionRestaurante, ModoPago } from '@serviceagent/shared';
import { ErrorApi } from './api';

/*
 * Lógica pura del modo de pago en /admin (US-22, D55): textos de cada modo, quién lo cambió y
 * mensajes de error. El componente solo pinta lo que sale de aquí.
 */

/** Zona del restaurante: la hora del último cambio no depende de la zona de la computadora. */
export const ZONA_HORARIA_RESTAURANTE = 'America/Chihuahua';

export interface DescripcionModoPago {
  titulo: string;
  /** Qué pasa con los pedidos nuevos en este modo. */
  detalle: string;
}

export const DESCRIPCION_MODO_PAGO: Record<ModoPago, DescripcionModoPago> = {
  al_recoger: {
    titulo: 'Pago al recoger',
    detalle:
      'El cliente paga en caja, en efectivo o con tarjeta. El pedido va a cocina en cuanto se confirma.',
  },
  transferencia: {
    titulo: 'Transferencia antes de preparar',
    detalle:
      'El cliente paga por transferencia. El pedido espera el pago y va a cocina cuando se confirma.',
  },
};

/** Orden en que se muestran las opciones. */
export const MODOS_EN_PANTALLA: readonly ModoPago[] = ['al_recoger', 'transferencia'];

/**
 * Aviso al elegir transferencia: mientras no existan el Banco Simulado (US-24) ni la conciliación
 * (US-25), un pedido por transferencia se queda esperando el pago y nunca llega a cocina.
 */
export const AVISO_TRANSFERENCIA =
  'Todavía no hay forma de recibir transferencias (Banco Simulado y conciliación): los pedidos nuevos se quedarían esperando pago y no llegarían a cocina.';

/** "Lo cambió Admin de prueba el 21/10 a las 01:05", o el texto de la configuración inicial. */
export function textoUltimoCambio(
  configuracion: ConfiguracionRestaurante,
  zonaHoraria = ZONA_HORARIA_RESTAURANTE,
): string {
  if (configuracion.actualizadoPor === null) return 'Configuración inicial: nadie la ha cambiado.';
  const fecha = new Date(configuracion.actualizadoEn);
  const dia = new Intl.DateTimeFormat('es-MX', {
    timeZone: zonaHoraria,
    day: '2-digit',
    month: '2-digit',
  }).format(fecha);
  const hora = new Intl.DateTimeFormat('es-MX', {
    timeZone: zonaHoraria,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(fecha);
  return `Lo cambió ${configuracion.actualizadoPor} el ${dia} a las ${hora}.`;
}

/** Mensajes sin códigos técnicos. Un 401 ya cierra la sesión antes de llegar aquí. */
export function mensajeErrorConfiguracion(error: unknown, accion: 'leer' | 'guardar'): string {
  if (error instanceof ErrorApi && error.status === 403) {
    return 'Solo el administrador puede ver y cambiar el modo de pago.';
  }
  return accion === 'leer'
    ? 'No se pudo cargar el modo de pago. Intenta de nuevo.'
    : 'No se pudo cambiar el modo de pago. Intenta de nuevo; el modo sigue como estaba.';
}
