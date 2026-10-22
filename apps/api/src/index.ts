import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import pkg from '../package.json';
import { crearClienteRetell } from './lib/clienteRetell';
import type { AppEnv } from './lib/env';
import { crearRepoChat } from './lib/repoChat';
import { crearRepoCocina } from './lib/repoCocina';
import { crearRepoEmpleados } from './lib/repoEmpleados';
import { crearRepoMenu } from './lib/repoMenu';
import { crearRepoPedidos } from './lib/repoPedidos';
import { crearClienteSupabase } from './lib/supabase';
import { registrarAuth, type DependenciasAuth } from './routes/auth';
import { ERROR_PETICION_INVALIDA, registrarChat, type DependenciasChat } from './routes/chat';
import { ERROR_PETICION_COCINA, registrarCocina, type DependenciasCocina } from './routes/cocina';
import { registrarHealth } from './routes/health';
import { registrarMenu, type DependenciasMenu } from './routes/menu';
import { registrarPedidos, type DependenciasPedidos } from './routes/pedidos';

/** Servicios externos que usa la API. Los tests los reemplazan por versiones en memoria. */
export type Dependencias = DependenciasAuth &
  DependenciasMenu &
  DependenciasPedidos &
  DependenciasChat &
  DependenciasCocina;

const dependenciasReales: Dependencias = {
  crearRepoEmpleados: (env) => crearRepoEmpleados(crearClienteSupabase(env)),
  crearRepoMenu: (env) => crearRepoMenu(crearClienteSupabase(env)),
  crearRepoPedidos: (env) => crearRepoPedidos(crearClienteSupabase(env)),
  crearRepoChat: (env) => crearRepoChat(crearClienteSupabase(env)),
  crearRepoCocina: (env) => crearRepoCocina(crearClienteSupabase(env)),
  crearClienteRetell: (llave) => crearClienteRetell(llave),
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
  registrarChat(app, dependencias);
  registrarCocina(app, dependencias);

  // Igual que el manejador por defecto de Hono, salvo una cosa: en /chat/* y /cocina/* el 400 de
  // un cuerpo que no es JSON válido (Hono lo responde en texto) sale con el formato de su contrato.
  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 400) {
      if (c.req.path.startsWith('/chat/')) return c.json(ERROR_PETICION_INVALIDA, 400);
      if (c.req.path.startsWith('/cocina/')) return c.json(ERROR_PETICION_COCINA, 400);
    }
    if ('getResponse' in error) {
      const res = error.getResponse();
      return c.newResponse(res.body, res);
    }
    console.error(error);
    return c.text('Internal Server Error', 500);
  });

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
