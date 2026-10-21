import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { ErrorCajaSchema, RespuestaPedidosCajaSchema } from '@serviceagent/shared';
import type { z } from 'zod';
import { requiereRol } from '../lib/auth';
import type { AppEnv, Bindings } from '../lib/env';
import { obtenerPedidosCaja, type CajaRepo } from '../services/caja';

export interface DependenciasCaja {
  crearRepoCaja: (env: Bindings) => CajaRepo;
}

const tags = ['Caja'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

export const pedidosCajaRoute = createRoute({
  method: 'get',
  path: '/caja/pedidos',
  tags,
  summary: 'Pedidos del día para cobrar y entregar (pantalla /caja)',
  description:
    'Rol `caja` (y `admin`). Pedidos creados hoy (día de America/Chihuahua) y los de días ' +
    'anteriores que siguen abiertos, del folio menor al mayor. Por pedido: folio, nombre, ' +
    'últimos 4 dígitos del teléfono, estado y desde cuándo, total y si ya está pagado y con qué. ' +
    "La pantalla lo vuelve a pedir cuando llega la señal de Realtime (canal 'pedidos', evento " +
    "'cambio', D12), que también se manda al registrar un pago.",
  security: [{ Bearer: [] }],
  middleware: [requiereRol('caja')] as const,
  responses: {
    200: { content: json(RespuestaPedidosCajaSchema), description: 'Pedidos de caja' },
    401: { content: json(ErrorCajaSchema), description: 'Sin sesión o sesión vencida' },
    403: { content: json(ErrorCajaSchema), description: 'El rol no es caja ni admin' },
    500: { content: json(ErrorCajaSchema), description: 'Error al leer los pedidos' },
  },
});

export function registrarCaja(app: OpenAPIHono<AppEnv>, deps: DependenciasCaja) {
  app.openapi(pedidosCajaRoute, async (c) => {
    try {
      const pedidos = await obtenerPedidosCaja(deps.crearRepoCaja(c.env));
      return c.json({ pedidos }, 200);
    } catch (error) {
      console.error('GET /caja/pedidos', error);
      return c.json(
        { error: 'No se pudieron leer los pedidos. Intenta de nuevo en un momento.' },
        500,
      );
    }
  });
}
