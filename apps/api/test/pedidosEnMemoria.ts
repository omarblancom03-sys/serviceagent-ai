import type { EstadoPedido } from '@serviceagent/shared';
import type { NuevoPedido, PedidosRepo } from '../src/services/pedido';

export interface PedidoEnMemoria extends NuevoPedido {
  folio: number;
  estado: EstadoPedido;
  creadoEn: Date;
}

/**
 * Repo de pedidos en memoria con las mismas reglas que la función SQL `crear_pedido`: folio desde
 * 1001, duplicado = mismo teléfono + misma huella + no cancelado + dentro de la ventana, y la suma
 * de los subtotales debe dar el total. `pedidos` queda expuesto para que el test lo revise.
 */
export function crearRepoPedidosEnMemoria(): PedidosRepo & { pedidos: PedidoEnMemoria[] } {
  const pedidos: PedidoEnMemoria[] = [];
  return {
    pedidos,
    async guardarPedido(pedido, minutosDuplicado, ahora) {
      const desde = ahora.getTime() - minutosDuplicado * 60_000;
      const previo = pedidos
        .filter(
          (p) =>
            p.telefono === pedido.telefono &&
            p.huella === pedido.huella &&
            p.estado !== 'cancelado' &&
            p.creadoEn.getTime() > desde,
        )
        .at(-1);
      if (previo) {
        return {
          folio: previo.folio,
          totalCentavos: previo.totalCentavos,
          estado: previo.estado,
          yaExistia: true,
        };
      }

      const suma = pedido.renglones.reduce((total, r) => total + r.subtotalCentavos, 0);
      if (suma !== pedido.totalCentavos) throw new Error('El total no coincide con los renglones.');

      const folio = 1001 + pedidos.length;
      pedidos.push({ ...pedido, folio, estado: 'confirmado', creadoEn: ahora });
      return { folio, totalCentavos: pedido.totalCentavos, estado: 'confirmado', yaExistia: false };
    },
  };
}

/** Repo que siempre falla, como si Supabase no respondiera. */
export const repoPedidosQueFalla: PedidosRepo = {
  async guardarPedido() {
    throw new Error('Supabase no responde');
  },
};
