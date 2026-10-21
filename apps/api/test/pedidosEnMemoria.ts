import type { EstadoPedido, ModoPago } from '@serviceagent/shared';
import type { NuevoPedido, PedidosRepo } from '../src/services/pedido';

export interface PedidoEnMemoria extends NuevoPedido {
  folio: number;
  estado: EstadoPedido;
  modoPago: ModoPago;
  creadoEn: Date;
}

/**
 * Repo de pedidos en memoria con las mismas reglas que la función SQL `crear_pedido`: folio desde
 * 1001, duplicado = mismo teléfono + misma huella (incluye el nombre) + no cancelado + dentro de la ventana, y la suma
 * de los subtotales debe dar el total. `pedidos` queda expuesto para que el test lo revise, y
 * `ahora` hace de reloj de la base (D42): el test lo mueve para simular el paso del tiempo.
 * `modoPago` hace de la configuración del restaurante (D55): con transferencia, el pedido nuevo
 * queda en 'esperando_pago'.
 */
export function crearRepoPedidosEnMemoria(
  ahora = new Date(),
): PedidosRepo & { pedidos: PedidoEnMemoria[]; ahora: Date; modoPago: ModoPago } {
  const pedidos: PedidoEnMemoria[] = [];
  const repo = {
    pedidos,
    ahora,
    modoPago: 'al_recoger' as ModoPago,
    async guardarPedido(pedido: NuevoPedido, minutosDuplicado: number) {
      const desde = repo.ahora.getTime() - minutosDuplicado * 60_000;
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
          modoPago: previo.modoPago,
          yaExistia: true,
        };
      }

      const suma = pedido.renglones.reduce((total, r) => total + r.subtotalCentavos, 0);
      if (suma !== pedido.totalCentavos) throw new Error('El total no coincide con los renglones.');

      const folio = 1001 + pedidos.length;
      const modoPago = repo.modoPago;
      const estado: EstadoPedido = modoPago === 'transferencia' ? 'esperando_pago' : 'en_cola';
      pedidos.push({ ...pedido, folio, estado, modoPago, creadoEn: repo.ahora });
      return {
        folio,
        totalCentavos: pedido.totalCentavos,
        estado,
        modoPago,
        yaExistia: false,
      };
    },
  };
  return repo;
}

/** Repo que siempre falla, como si Supabase no respondiera. */
export const repoPedidosQueFalla: PedidosRepo = {
  async guardarPedido() {
    throw new Error('Supabase no responde');
  },
};
