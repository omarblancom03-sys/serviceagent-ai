import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import { HealthResponseSchema } from '@serviceagent/shared';
import pkg from '../../package.json';
import type { AppEnv } from '../lib/env';

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Sistema'],
  summary: 'Verifica que la API está viva',
  responses: {
    200: {
      content: { 'application/json': { schema: HealthResponseSchema } },
      description: 'La API responde correctamente',
    },
  },
});

export function registrarHealth(app: OpenAPIHono<AppEnv>) {
  app.openapi(healthRoute, (c) => c.json({ ok: true as const, version: pkg.version }, 200));
}
