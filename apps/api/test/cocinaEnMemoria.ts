import {
  ESTADOS_COCINA,
  type EstadoCocina,
  type EstadoPedido,
  type RenglonCocina,
} from '@serviceagent/shared';
import type { CocinaRepo, PedidoActivo } from '../src/services/cocina';

/** Una fila de `historial_estado_pedido`. */
export interface FilaHistorialEnMemoria {
  id: number;
  estado: EstadoPedido;
  creadoEn: Date;
  idEmpleado: string | null;
}

export interface PedidoEnMemoria {
  folio: number;
  nombreCliente: string;
  estado: EstadoPedido;
  renglones: RenglonCocina[];
  historial: FilaHistorialEnMemoria[];
}

const ANTERIOR = { preparando: 'en_cola', listo: 'preparando' } as const;

/**
 * `CocinaRepo` en memoria con las mismas reglas que `cambiar_estado_cocina` y
 * `deshacer_estado_cocina` (supabase/migrations/*_cocina_cambio_estado.sql). `reloj.ahora` hace
 * de `now()`: el test lo mueve para probar el plazo de deshacer.
 */
export function crearCocinaEnMemoria(pedidos: PedidoEnMemoria[] = []) {
  const reloj = { ahora: new Date('2026-10-22T18:00:00Z') };
  let siguienteId = 1000;

  const repo: CocinaRepo = {
    leerPedidosActivos() {
      const activos: PedidoActivo[] = pedidos
        .filter((p) => (ESTADOS_COCINA as readonly string[]).includes(p.estado))
        .map((p) => ({
          folio: p.folio,
          nombreCliente: p.nombreCliente,
          estado: p.estado as EstadoCocina,
          enColaDesde: new Date(
            Math.max(
              ...p.historial.filter((h) => h.estado === 'en_cola').map((h) => h.creadoEn.getTime()),
            ),
          ),
          renglones: p.renglones,
        }));
      return Promise.resolve(activos);
    },

    cambiarEstado({ folio, desde, hacia, idEmpleado }) {
      const pedido = pedidos.find((p) => p.folio === folio);
      if (!pedido) return Promise.resolve(null);
      if (pedido.estado !== desde) {
        return Promise.resolve({ estadoActual: pedido.estado, cambiadoEn: null });
      }
      pedido.estado = hacia;
      const ahora = new Date(reloj.ahora);
      pedido.historial.push({ id: siguienteId++, estado: hacia, creadoEn: ahora, idEmpleado });
      return Promise.resolve({ estadoActual: hacia, cambiadoEn: ahora });
    },

    deshacerEstado({ folio, estado, segundosPlazo }) {
      const pedido = pedidos.find((p) => p.folio === folio);
      if (!pedido) return Promise.resolve(null);
      const ultima = [...pedido.historial].sort(
        (a, b) => b.creadoEn.getTime() - a.creadoEn.getTime() || b.id - a.id,
      )[0];
      if (pedido.estado !== estado || ultima?.estado !== estado) {
        return Promise.resolve({ estadoActual: pedido.estado, motivo: 'estado_distinto' as const });
      }
      if (reloj.ahora.getTime() - ultima.creadoEn.getTime() > segundosPlazo * 1000) {
        return Promise.resolve({ estadoActual: pedido.estado, motivo: 'plazo_vencido' as const });
      }
      pedido.historial = pedido.historial.filter((h) => h.id !== ultima.id);
      pedido.estado = ANTERIOR[estado];
      return Promise.resolve({ estadoActual: pedido.estado, motivo: null });
    },
  };

  return { repo, pedidos, reloj };
}

/** Pedido recién creado por `crear_pedido` en modo al_confirmar (D46): ya en la cola. */
export function pedidoEnCola(
  folio: number,
  creadoEn = new Date('2026-10-22T17:55:00Z'),
): PedidoEnMemoria {
  return {
    folio,
    nombreCliente: `Cliente ${folio}`,
    estado: 'en_cola',
    renglones: [{ tipo: 'extra' as const, cantidad: 1, nombre: 'Totopos' }],
    historial: [
      { id: folio * 10, estado: 'confirmado', creadoEn, idEmpleado: null },
      { id: folio * 10 + 1, estado: 'en_cola', creadoEn, idEmpleado: null },
    ],
  };
}
