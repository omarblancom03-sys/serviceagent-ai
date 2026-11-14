import {
  MAX_CARACTERES_MOTIVO_CANCELACION,
  type CancelarPedidoArgs,
  type DatoClienteInvalido,
  type EstadoPedido,
  type RechazoCancelacion,
  type RespuestaCancelarPedido,
} from '@serviceagent/shared';
import { DETALLE_FALTA_TELEFONO, DETALLE_TELEFONO, normalizarTelefono } from './pedido';

/*
 * Cancelar un pedido por el agente (US-14, D71). El cliente da su folio y su teléfono; si
 * coinciden y el pedido todavía no entra a preparación ni tiene pagos, queda cancelado con su
 * motivo. La regla la cumple la base en una sola función con la fila bloqueada (D14): aquí solo se
 * revisa lo que mandó el agente y se traduce el resultado a algo que el agente pueda decir.
 */

export const DETALLE_MOTIVO_CANCELACION_LARGO =
  `El motivo debe tener como máximo ${MAX_CARACTERES_MOTIVO_CANCELACION} caracteres: ` +
  'resúmelo y vuelve a llamar a cancelar_pedido.';

/** Qué decirle al cliente en cada rechazo. Lo lee el agente: no trae datos del pedido. */
export const DETALLE_RECHAZO: Record<RechazoCancelacion, string> = {
  no_encontrado:
    'No hay un pedido con ese número y ese teléfono. Pídele al cliente que revise los dos datos.',
  en_preparacion:
    'El pedido ya está en preparación y no se puede cancelar. Ofrécele hablar con un empleado.',
  con_pago:
    'El pedido ya tiene un pago y no se puede cancelar desde el chat. Ofrécele hablar con un empleado.',
  cerrado: 'El pedido ya se entregó o ya venció: no hay nada que cancelar.',
};

/** Lo que responde la función SQL `cancelar_pedido_cliente`. */
export type ResultadoCancelar =
  | { resultado: 'cancelado' | 'ya_cancelado' }
  | { resultado: 'no_encontrado' }
  | { resultado: 'con_pago' | 'no_cancelable'; estadoActual: EstadoPedido };

/** Interfaz de datos. La implementa `lib/repoCancelaciones.ts` (Supabase) o un repo en memoria. */
export interface CancelacionesRepo {
  /**
   * Cancela el pedido si el folio es de ese teléfono, no ha entrado a preparación y no tiene
   * pagos; guarda el motivo en el historial. Todo en una función SQL con la fila bloqueada: si
   * cocina pulsa Empezar al mismo tiempo, gana el que llegue primero (D14).
   */
  cancelarPedido(datos: {
    folio: number;
    telefono: string;
    motivo: string;
  }): Promise<ResultadoCancelar>;
}

const SIN_RECHAZO = { rechazo: null, estadoActual: null, detalle: null } as const;

function rechazar(rechazo: RechazoCancelacion, estadoActual: EstadoPedido | null) {
  return {
    ok: false as const,
    rechazo,
    estadoActual,
    detalle: DETALLE_RECHAZO[rechazo],
    faltaFolio: false,
    datosCliente: [],
    aclaracionMotivo: null,
  };
}

/**
 * Revisa lo que mandó el agente y, si todo sirve, cancela. Lo que haya que volver a pedir (folio,
 * teléfono, motivo largo) sale junto en una respuesta, sin tocar la base. Los errores del repo se
 * propagan (la ruta responde 500).
 */
export async function cancelarPedido(
  repo: CancelacionesRepo,
  args: CancelarPedidoArgs,
): Promise<RespuestaCancelarPedido> {
  const datosCliente: DatoClienteInvalido[] = [];
  const telefono = args.telefono === undefined ? null : normalizarTelefono(args.telefono);
  if (telefono === null) {
    const detalle = args.telefono === undefined ? DETALLE_FALTA_TELEFONO : DETALLE_TELEFONO;
    datosCliente.push({ campo: 'telefono', detalle });
  }
  const aclaracionMotivo =
    args.motivo.length > MAX_CARACTERES_MOTIVO_CANCELACION
      ? DETALLE_MOTIVO_CANCELACION_LARGO
      : null;

  if (args.folio === undefined || telefono === null || aclaracionMotivo !== null) {
    return {
      ok: false,
      ...SIN_RECHAZO,
      faltaFolio: args.folio === undefined,
      datosCliente,
      aclaracionMotivo,
    };
  }

  const { folio } = args;
  const cancelacion = await repo.cancelarPedido({ folio, telefono, motivo: args.motivo });
  switch (cancelacion.resultado) {
    case 'cancelado':
    case 'ya_cancelado':
      return {
        ok: true,
        folio,
        folioTexto: `#${folio}`,
        estado: 'cancelado',
        yaEstabaCancelado: cancelacion.resultado === 'ya_cancelado',
      };
    case 'no_encontrado':
      return rechazar('no_encontrado', null);
    case 'con_pago':
      return rechazar('con_pago', cancelacion.estadoActual);
    case 'no_cancelable': {
      const { estadoActual } = cancelacion;
      const enCocina = estadoActual === 'preparando' || estadoActual === 'listo';
      return rechazar(enCocina ? 'en_preparacion' : 'cerrado', estadoActual);
    }
  }
}
