import type { EstadoPedido, MetodoPago, ModoPago } from '@serviceagent/shared';
import type { ResultadoPedirDatosRepo } from '../src/services/pago';
import type { NuevoPedido, PedidosRepo } from '../src/services/pedido';

/** La misma CLABE ficticia que la migración (D76). */
export const CLABE_DE_PRUEBA = '999180157000000005';

export interface PedidoEnMemoria extends Omit<NuevoPedido, 'metodoPago'> {
  folio: number;
  estado: EstadoPedido;
  modoPago: ModoPago;
  metodoPago: MetodoPago | null;
  referenciaPago: string | null;
  datosWhatsappPedidosEn: Date | null;
  creadoEn: Date;
}

/**
 * Repo de pedidos en memoria con las mismas reglas que la función SQL `crear_pedido`: folio desde
 * 1001, duplicado = mismo teléfono + misma huella (incluye el nombre) + no cancelado + dentro de la ventana, y la suma
 * de los subtotales debe dar el total. `pedidos` queda expuesto para que el test lo revise, y
 * `ahora` hace de reloj de la base (D42): el test lo mueve para simular el paso del tiempo.
 * `modoPago` hace de la configuración del restaurante (D55): con transferencia, el pedido nuevo
 * queda en 'esperando_pago', con método transferencia y la referencia `GRN-<folio>-K7` (en la base
 * los dos caracteres son al azar). Con pago al recoger, un método que no sea efectivo o tarjeta
 * truena, igual que la función SQL.
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
          metodoPago: previo.metodoPago,
          referenciaPago: previo.referenciaPago,
          clabeTransferencia: previo.referenciaPago ? CLABE_DE_PRUEBA : null,
          yaExistia: true,
        };
      }

      const suma = pedido.renglones.reduce((total, r) => total + r.subtotalCentavos, 0);
      if (suma !== pedido.totalCentavos) throw new Error('El total no coincide con los renglones.');

      const folio = 1001 + pedidos.length;
      const modoPago = repo.modoPago;
      const transferencia = modoPago === 'transferencia';
      if (!transferencia && pedido.metodoPago === 'transferencia') {
        throw new Error('Con pago al recoger el método es efectivo o tarjeta.');
      }
      const metodoPago: MetodoPago = transferencia ? 'transferencia' : pedido.metodoPago;
      const estado: EstadoPedido = transferencia ? 'esperando_pago' : 'en_cola';
      const referenciaPago = transferencia ? `GRN-${folio}-K7` : null;
      pedidos.push({
        ...pedido,
        folio,
        estado,
        modoPago,
        metodoPago,
        referenciaPago,
        datosWhatsappPedidosEn: null,
        creadoEn: repo.ahora,
      });
      return {
        folio,
        totalCentavos: pedido.totalCentavos,
        estado,
        modoPago,
        metodoPago,
        referenciaPago,
        clabeTransferencia: transferencia ? CLABE_DE_PRUEBA : null,
        yaExistia: false,
      };
    },
    async leerModoPago() {
      return repo.modoPago;
    },
    /** Mismas reglas que `pedir_datos_whatsapp`. */
    async pedirDatosWhatsapp(folio: number, telefono: string): Promise<ResultadoPedirDatosRepo> {
      const pedido = pedidos.find((p) => p.folio === folio && p.telefono === telefono);
      if (!pedido) return 'no_encontrado';
      if (pedido.metodoPago !== 'transferencia' || pedido.estado !== 'esperando_pago') {
        return 'no_aplica';
      }
      if (pedido.datosWhatsappPedidosEn) return 'ya_pedido';
      pedido.datosWhatsappPedidosEn = repo.ahora;
      return 'pedido';
    },
  };
  return repo;
}

/** Repo que siempre falla, como si Supabase no respondiera. */
export const repoPedidosQueFalla: PedidosRepo = {
  async guardarPedido() {
    throw new Error('Supabase no responde');
  },
  async leerModoPago() {
    throw new Error('Supabase no responde');
  },
  async pedirDatosWhatsapp() {
    throw new Error('Supabase no responde');
  },
};
