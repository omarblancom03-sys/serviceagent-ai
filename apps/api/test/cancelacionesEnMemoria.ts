import type { EstadoPedido } from '@serviceagent/shared';
import type { CancelacionesRepo, ResultadoCancelar } from '../src/services/cancelacion';

/** Un pedido en memoria, con lo que mira `cancelar_pedido_cliente`. */
export interface PedidoCancelableEnMemoria {
  folio: number;
  /** Los 10 dígitos guardados (D32). */
  telefono: string;
  estado: EstadoPedido;
  /** Cuántos pagos tiene registrados. */
  pagos: number;
  historial: { estado: EstadoPedido; motivo: string | null }[];
}

export const pedidoCancelable = (
  folio: number,
  estado: EstadoPedido,
  cambios: Partial<PedidoCancelableEnMemoria> = {},
): PedidoCancelableEnMemoria => ({
  folio,
  telefono: '6141234567',
  estado,
  pagos: 0,
  historial: [{ estado, motivo: null }],
  ...cambios,
});

const CANCELABLES: readonly EstadoPedido[] = ['confirmado', 'esperando_pago', 'en_cola'];

/**
 * Repo en memoria con las mismas reglas que la función SQL `cancelar_pedido_cliente`, en el mismo
 * orden: el folio tiene que ser de ese teléfono; ya cancelado no cambia nada; fuera de
 * `confirmado`, `esperando_pago` y `en_cola` no se cancela; con un pago tampoco. Al cancelar
 * cambia el estado y agrega la fila del historial con el motivo. Prueba la API, no el SQL (ese se
 * prueba con `supabase/ensayos/cancelar_pedido.sql`). `pedidos` y `llamadas` quedan expuestos para
 * que el test los revise.
 */
export function crearRepoCancelacionesEnMemoria(
  pedidos: PedidoCancelableEnMemoria[] = [],
): CancelacionesRepo & { pedidos: PedidoCancelableEnMemoria[]; llamadas: number } {
  const repo = {
    pedidos,
    llamadas: 0,
    cancelarPedido({
      folio,
      telefono,
      motivo,
    }: {
      folio: number;
      telefono: string;
      motivo: string;
    }): Promise<ResultadoCancelar> {
      repo.llamadas += 1;
      const pedido = pedidos.find((p) => p.folio === folio && p.telefono === telefono);
      if (!pedido) return Promise.resolve({ resultado: 'no_encontrado' });
      if (pedido.estado === 'cancelado') return Promise.resolve({ resultado: 'ya_cancelado' });
      if (!CANCELABLES.includes(pedido.estado)) {
        return Promise.resolve({ resultado: 'no_cancelable', estadoActual: pedido.estado });
      }
      if (pedido.pagos > 0) {
        return Promise.resolve({ resultado: 'con_pago', estadoActual: pedido.estado });
      }
      pedido.estado = 'cancelado';
      pedido.historial.push({ estado: 'cancelado', motivo });
      return Promise.resolve({ resultado: 'cancelado' });
    },
  };
  return repo;
}

/** Repo cuya base falla: para probar el 500 de la ruta. */
export const repoCancelacionesQueFalla = (): CancelacionesRepo => ({
  cancelarPedido: () => Promise.reject(new Error('Falló cancelar_pedido_cliente (código 57014)')),
});
