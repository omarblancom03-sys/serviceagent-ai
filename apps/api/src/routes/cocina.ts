import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { ErrorCocinaSchema, RespuestaPedidosCocinaSchema } from '@serviceagent/shared';
import type { z } from 'zod';
import { requiereRol } from '../lib/auth';
import type { AppEnv, Bindings } from '../lib/env';
import { obtenerPedidosCocina, type CocinaRepo } from '../services/cocina';

export interface DependenciasCocina {
  crearRepoCocina: (env: Bindings) => CocinaRepo;
}

const tags = ['Cocina'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

export const pedidosCocinaRoute = createRoute({
  method: 'get',
  path: '/cocina/pedidos',
  tags,
  summary: 'Pedidos que cocina debe preparar (pantalla /cocina)',
  description:
    "Rol `cocina` (y `admin`). Pedidos en 'en_cola' o 'preparando', del más antiguo al más nuevo " +
    'según la hora en que entraron a la cola. Solo lo que cocina necesita: folio, nombre, ' +
    'platillos con variante, ingredientes quitados y extras; sin precios ni teléfono. La pantalla ' +
    "lo vuelve a pedir cuando llega la señal de Realtime (canal 'pedidos', evento 'cambio', D12).",
  security: [{ Bearer: [] }],
  middleware: [requiereRol('cocina')] as const,
  responses: {
    200: { content: json(RespuestaPedidosCocinaSchema), description: 'Tickets de cocina' },
    401: { content: json(ErrorCocinaSchema), description: 'Sin sesión o sesión vencida' },
    403: { content: json(ErrorCocinaSchema), description: 'El rol no es cocina ni admin' },
    500: { content: json(ErrorCocinaSchema), description: 'Error al leer los pedidos' },
  },
});

export function registrarCocina(app: OpenAPIHono<AppEnv>, deps: DependenciasCocina) {
  app.openapi(pedidosCocinaRoute, async (c) => {
    try {
      const pedidos = await obtenerPedidosCocina(deps.crearRepoCocina(c.env));
      return c.json({ pedidos }, 200);
    } catch (error) {
      console.error('GET /cocina/pedidos', error);
      return c.json(
        { error: 'No se pudieron leer los pedidos. Intenta de nuevo en un momento.' },
        500,
      );
    }
  });
}
