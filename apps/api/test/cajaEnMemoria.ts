import { ESTADOS_COBRABLES_CAJA, type EstadoPedido, type MetodoPago } from '@serviceagent/shared';
import type { CajaRepo, PedidoCajaLeido } from '../src/services/caja';

/** Una fila de `pagos`, con quién la cobró (vacío en las transferencias). */
export interface PagoEnMemoria {
  metodo: MetodoPago;
  montoCentavos: number;
  creadoEn: Date;
  idEmpleado: string | null;
}

/** Una fila de `historial_estado_pedido`. */
export interface HistorialCajaEnMemoria {
  estado: EstadoPedido;
  creadoEn: Date;
  idEmpleado: string | null;
}

export interface PedidoCajaEnMemoria extends Omit<PedidoCajaLeido, 'pagos' | 'historial'> {
  pagos: PagoEnMemoria[];
  historial: HistorialCajaEnMemoria[];
}

const pagadoDe = (pedido: PedidoCajaEnMemoria) =>
  pedido.pagos.reduce((suma, pago) => suma + pago.montoCentavos, 0);

/**
 * `CajaRepo` en memoria con las mismas reglas que `cobrar_pedido_caja` y `entregar_pedido_caja`
 * (supabase/migrations/*_caja_cobro_entrega.sql, US-21): cobra lo que falta una sola vez y solo en
 * la cola, preparándose o listo; entrega solo lo listo y pagado. Cada operación lee y escribe sin
 * `await` de por medio, así que es atómica, como la función SQL con su `for update`.
 * `reloj.ahora` hace de `now()`. `leerPedidosCaja` devuelve todos: el filtro por día es de la
 * consulta real (repoCaja.ts).
 */
export function crearCajaEnMemoria(pedidos: PedidoCajaEnMemoria[] = []) {
  const reloj = { ahora: new Date('2026-11-12T18:00:00Z') };

  const repo: CajaRepo = {
    leerPedidosCaja() {
      return Promise.resolve(
        pedidos.map((p) => ({ ...p, pagos: [...p.pagos], historial: [...p.historial] })),
      );
    },

    cobrarPedido({ folio, metodo, idEmpleado }) {
      const pedido = pedidos.find((p) => p.folio === folio);
      if (!pedido) return Promise.resolve(null);
      const pagado = pagadoDe(pedido);
      if (pagado >= pedido.totalCentavos) {
        return Promise.resolve({ resultado: 'ya_pagado', estadoActual: pedido.estado });
      }
      if (!(ESTADOS_COBRABLES_CAJA as readonly string[]).includes(pedido.estado)) {
        return Promise.resolve({ resultado: 'estado_no_cobrable', estadoActual: pedido.estado });
      }
      const montoCentavos = pedido.totalCentavos - pagado;
      const cobradoEn = new Date(reloj.ahora);
      pedido.pagos.push({ metodo, montoCentavos, creadoEn: cobradoEn, idEmpleado });
      return Promise.resolve({ resultado: 'cobrado', montoCentavos, cobradoEn });
    },

    entregarPedido({ folio, idEmpleado }) {
      const pedido = pedidos.find((p) => p.folio === folio);
      if (!pedido) return Promise.resolve(null);
      if (pedido.estado !== 'listo') {
        return Promise.resolve({ resultado: 'estado_distinto', estadoActual: pedido.estado });
      }
      if (pagadoDe(pedido) < pedido.totalCentavos) {
        return Promise.resolve({ resultado: 'falta_pago', estadoActual: pedido.estado });
      }
      const entregadoEn = new Date(reloj.ahora);
      pedido.estado = 'entregado';
      pedido.historial.push({ estado: 'entregado', creadoEn: entregadoEn, idEmpleado });
      return Promise.resolve({ resultado: 'entregado', entregadoEn });
    },
  };

  return { repo, pedidos, reloj };
}

/** Para los tests que solo leen la lista: cobrar y entregar no deben llamarse. */
export const accionesSinUso: Pick<CajaRepo, 'cobrarPedido' | 'entregarPedido'> = {
  cobrarPedido: () => Promise.reject(new Error('cobrarPedido no se usa en este test')),
  entregarPedido: () => Promise.reject(new Error('entregarPedido no se usa en este test')),
};
