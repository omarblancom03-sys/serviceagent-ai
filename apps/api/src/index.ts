import { swaggerUI } from '@hono/swagger-ui';
import { OpenAPIHono } from '@hono/zod-openapi';
import pkg from '../package.json';
import { registrarHealth } from './routes/health';

export const app = new OpenAPIHono();

registrarHealth(app);

// Documentación OpenAPI (JSON) y Swagger UI.
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'ServiceAgent AI — API',
    version: pkg.version,
    description: 'API del sistema de pedidos del restaurante Tex-Mex.',
  },
});
app.get('/docs', swaggerUI({ url: '/openapi.json' }));

export default app;
