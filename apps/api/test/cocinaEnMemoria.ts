import {
  ESTADOS_COCINA,
  type EstadoCocina,
  type EstadoPedido,
  type RenglonCocina,
} from '@serviceagent/shared';
import type { CocinaRepo, PedidoActivo, PedidoTerminado } from '../src/services/cocina';

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

/** Última hora en que el historial dice `estado`, o `null` si nunca lo dice. */
function ultimaHora(pedido: PedidoEnMemoria, estado: EstadoPedido): number | null {
  const horas = pedido.historial
    .filter((h) => h.estado === estado)
    .map((h) => h.creadoEn.getTime());
  return horas.length > 0 ? Math.max(...horas) : null;
}

/**
 * `CocinaRepo` en memoria con las mismas reglas que `cambiar_estado_cocina` y
 * `deshacer_estado_cocina` (supabase/migrations/*_cocina_cambio_estado.sql), y que
 * `leer_terminados_cocina` y `regresar_pedido_cocina` (*_cocina_terminados_recientes.sql, US-52).
 * `reloj.ahora` hace de `now()`: el test lo mueve para probar los plazos.
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
          enColaDesde: new Date(ultimaHora(p, 'en_cola') ?? 0),
          renglones: p.renglones,
        }));
      return Promise.resolve(activos);
    },

    leerTerminados({ minutos, limite }) {
      const corte = reloj.ahora.getTime() - minutos * 60_000;
      const terminados: PedidoTerminado[] = pedidos.flatMap((p) => {
        const terminadoEn = ultimaHora(p, 'listo');
        if (p.estado !== 'listo' || terminadoEn === null || terminadoEn <= corte) return [];
        return [
          {
            folio: p.folio,
            nombreCliente: p.nombreCliente,
            enColaDesde: new Date(ultimaHora(p, 'en_cola') ?? 0),
            terminadoEn: new Date(terminadoEn),
            renglones: p.renglones,
          },
        ];
      });
      terminados.sort(
        (a, b) => b.terminadoEn.getTime() - a.terminadoEn.getTime() || b.folio - a.folio,
      );
      return Promise.resolve(terminados.slice(0, limite));
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

    regresarPedido({ folio, idEmpleado, minutosPlazo }) {
      const pedido = pedidos.find((p) => p.folio === folio);
      if (!pedido) return Promise.resolve(null);
      if (pedido.estado !== 'listo') {
        return Promise.resolve({
          estadoActual: pedido.estado,
          motivo: 'estado_distinto' as const,
          cambiadoEn: null,
        });
      }
      const terminadoEn = ultimaHora(pedido, 'listo');
      if (terminadoEn === null || reloj.ahora.getTime() - terminadoEn > minutosPlazo * 60_000) {
        return Promise.resolve({
          estadoActual: pedido.estado,
          motivo: 'plazo_vencido' as const,
          cambiadoEn: null,
        });
      }
      const ahora = new Date(reloj.ahora);
      pedido.estado = 'preparando';
      pedido.historial.push({
        id: siguienteId++,
        estado: 'preparando',
        creadoEn: ahora,
        idEmpleado,
      });
      return Promise.resolve({ estadoActual: 'preparando', motivo: null, cambiadoEn: ahora });
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
