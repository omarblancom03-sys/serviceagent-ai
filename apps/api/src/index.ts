import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import pkg from '../package.json';
import type { AppEnv } from './lib/env';
import { crearRepoEmpleados } from './lib/repoEmpleados';
import { crearClienteSupabase } from './lib/supabase';
import { registrarAuth, type DependenciasAuth } from './routes/auth';
import { registrarHealth } from './routes/health';

/** Servicios externos que usa la API. Los tests los reemplazan por versiones en memoria. */
export type Dependencias = DependenciasAuth;

const dependenciasReales: Dependencias = {
  crearRepoEmpleados: (env) => crearRepoEmpleados(crearClienteSupabase(env)),
};

export function crearApp(dependencias: Dependencias = dependenciasReales) {
  const app = new OpenAPIHono<AppEnv>();

  app.use(
    '*',
    cors({
      origin: (origen, c) => {
        const permitidos = String(c.env?.CORS_ORIGINS ?? '')
          .split(',')
          .map((o) => o.trim());
        return permitidos.includes(origen) ? origen : null;
      },
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  registrarHealth(app);
  registrarAuth(app, dependencias);

  // Documentación OpenAPI (JSON) y Swagger UI.
  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: {
      title: 'ServiceAgent AI — API',
      version: pkg.version,
      description: 'API del sistema de pedidos del restaurante Tex-Mex.',
    },
  });
  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  return app;
}

export const app = crearApp();

export default app;
