import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import pkg from '../package.json';
import type { AppEnv } from './lib/env';
import { crearRepoEmpleados } from './lib/repoEmpleados';
import { crearRepoMenu } from './lib/repoMenu';
import { crearRepoPedidos } from './lib/repoPedidos';
import { crearClienteSupabase } from './lib/supabase';
import { registrarAuth, type DependenciasAuth } from './routes/auth';
import { registrarHealth } from './routes/health';
import { registrarMenu, type DependenciasMenu } from './routes/menu';
import { registrarPedidos, type DependenciasPedidos } from './routes/pedidos';

/** Servicios externos que usa la API. Los tests los reemplazan por versiones en memoria. */
export type Dependencias = DependenciasAuth & DependenciasMenu & DependenciasPedidos;

const dependenciasReales: Dependencias = {
  crearRepoEmpleados: (env) => crearRepoEmpleados(crearClienteSupabase(env)),
  crearRepoMenu: (env) => crearRepoMenu(crearClienteSupabase(env)),
  crearRepoPedidos: (env) => crearRepoPedidos(crearClienteSupabase(env)),
};

/** Cada test pasa solo las dependencias que usa; las demás son las reales. */
export function crearApp(reemplazos: Partial<Dependencias> = {}) {
  const dependencias: Dependencias = { ...dependenciasReales, ...reemplazos };
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
  registrarMenu(app, dependencias);
  registrarPedidos(app, dependencias);

  // Documentación OpenAPI (JSON) y Swagger UI.
  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'FirmaRetell', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Retell-Signature',
    description: '`v=<timestamp ms>,d=<HMAC-SHA256(cuerpo + timestamp, RETELL_API_KEY)>`',
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
