import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorMenuSchema,
  ParamsProductoSchema,
  RespuestaMenuSchema,
  RespuestaProductoDetalleSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv } from '../lib/env';

const tags = ['Menú'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

export const menuRoute = createRoute({
  method: 'get',
  path: '/menu',
  tags,
  summary: 'Menú público: categorías, platillos con variantes y extras',
  description:
    'Pública. Solo productos con activo=true; los agotados salen con disponible=false. ' +
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
  summary: 'Detalle de un platillo con sus variantes y extras permitidos',
  description: 'Pública. Montos en centavos.',
  request: { params: ParamsProductoSchema },
  responses: {
    200: { content: json(RespuestaProductoDetalleSchema), description: 'Platillo encontrado' },
    400: { description: 'El id no es un entero positivo' },
    404: {
      content: json(ErrorMenuSchema),
      description: 'No existe un platillo activo con ese id',
    },
    500: { content: json(ErrorMenuSchema), description: 'Error al leer el menú' },
  },
});

/** Solo documenta el contrato en Swagger: la lectura de la base se implementa en US-03-P2. */
export function registrarMenu(app: OpenAPIHono<AppEnv>) {
  app.openAPIRegistry.registerPath(menuRoute);
  app.openAPIRegistry.registerPath(productoDetalleRoute);
}
