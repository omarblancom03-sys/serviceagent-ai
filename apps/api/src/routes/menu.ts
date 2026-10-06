import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorMenuSchema,
  ParamsProductoSchema,
  RespuestaMenuSchema,
  RespuestaProductoDetalleSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv, Bindings } from '../lib/env';
import { obtenerMenu, obtenerPlatillo, type MenuRepo } from '../services/menu';

export interface DependenciasMenu {
  crearRepoMenu: (env: Bindings) => MenuRepo;
}

const tags = ['Menú'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const ERROR_LECTURA = 'No se pudo leer el menú. Intenta de nuevo en un momento.';

export const menuRoute = createRoute({
  method: 'get',
  path: '/menu',
  tags,
  summary: 'Menú público: categorías, platillos con variantes y extras',
  description:
    'Pública. Solo productos con activo=true; los agotados salen con disponible=false. ' +
    'Las categorías sin platillos visibles no aparecen. ' +
    'Los extras que se venden sueltos van en `extras`; los ligados a un platillo, en su `extrasPermitidos` (D19). ' +
    'Montos en centavos.',
  responses: {
    200: { content: json(RespuestaMenuSchema), description: 'Menú vigente' },
    500: { content: json(ErrorMenuSchema), description: 'Error al leer el menú' },
  },
});

export const productoDetalleRoute = createRoute({
  method: 'get',
  path: '/menu/productos/{id}',
  tags,
  summary: 'Detalle de un platillo con sus variantes, extras permitidos e ingredientes removibles',
  description: 'Pública. Devuelve el platillo tal como sale en `GET /menu`. Montos en centavos.',
  request: { params: ParamsProductoSchema },
  responses: {
    200: { content: json(RespuestaProductoDetalleSchema), description: 'Platillo encontrado' },
    400: { content: json(ErrorMenuSchema), description: 'El id no es un entero positivo' },
    404: {
      content: json(ErrorMenuSchema),
      description: 'No existe un platillo visible en el menú con ese id',
    },
    500: { content: json(ErrorMenuSchema), description: 'Error al leer el menú' },
  },
});

export function registrarMenu(app: OpenAPIHono<AppEnv>, deps: DependenciasMenu) {
  app.openapi(menuRoute, async (c) => {
    try {
      return c.json(await obtenerMenu(deps.crearRepoMenu(c.env)), 200);
    } catch (error) {
      console.error('GET /menu', error);
      return c.json({ error: ERROR_LECTURA }, 500);
    }
  });

  app.openapi(
    productoDetalleRoute,
    async (c) => {
      const { id } = c.req.valid('param');
      try {
        const platillo = await obtenerPlatillo(deps.crearRepoMenu(c.env), id);
        if (!platillo) return c.json({ error: 'No encontramos ese platillo en el menú.' }, 404);
        return c.json({ platillo }, 200);
      } catch (error) {
        console.error('GET /menu/productos/{id}', error);
        return c.json({ error: ERROR_LECTURA }, 500);
      }
    },
    // Si el id no es válido, responde con el mismo formato de error que el resto del menú.
    (resultado, c) => {
      if (!resultado.success) {
        return c.json({ error: 'El id del platillo debe ser un entero positivo.' }, 400);
      }
    },
  );
}
