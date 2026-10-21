import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CambiarConfiguracionPeticionSchema,
  ConfiguracionRestauranteSchema,
  ErrorConfiguracionSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import { requiereRol } from '../lib/auth';
import type { AppEnv, Bindings } from '../lib/env';
import {
  cambiarModoPago,
  obtenerConfiguracion,
  type ConfiguracionRepo,
} from '../services/configuracion';

export interface DependenciasConfiguracion {
  crearRepoConfiguracion: (env: Bindings) => ConfiguracionRepo;
}

const tags = ['Administración'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const errores = {
  401: { content: json(ErrorConfiguracionSchema), description: 'Sin sesión o sesión vencida' },
  403: { content: json(ErrorConfiguracionSchema), description: 'El rol no es admin' },
  500: { content: json(ErrorConfiguracionSchema), description: 'Error al leer o guardar' },
};

export const leerConfiguracionRoute = createRoute({
  method: 'get',
  path: '/admin/configuracion',
  tags,
  summary: 'Configuración del restaurante: modo de pago',
  description:
    'Solo `admin`. `modoPago`: `al_recoger` (se paga en caja; el pedido va a cocina al ' +
    'confirmarse) o `transferencia` (se paga antes; el pedido espera el pago para ir a cocina). ' +
    'Con quién y cuándo se cambió por última vez (D55).',
  security: [{ Bearer: [] }],
  middleware: [requiereRol('admin')] as const,
  responses: {
    200: { content: json(ConfiguracionRestauranteSchema), description: 'Configuración vigente' },
    ...errores,
  },
});

export const cambiarConfiguracionRoute = createRoute({
  method: 'patch',
  path: '/admin/configuracion',
  tags,
  summary: 'Cambiar el modo de pago',
  description:
    'Solo `admin`. Guarda el modo nuevo con el empleado de la sesión y la hora, y deja el cambio ' +
    'en el historial. Si el modo ya era ese, no cambia nada. Los pedidos que ya existen conservan ' +
    'el modo con que se crearon; solo cambian los nuevos (D55).',
  security: [{ Bearer: [] }],
  middleware: [requiereRol('admin')] as const,
  request: { body: { content: json(CambiarConfiguracionPeticionSchema), required: true } },
  responses: {
    200: { content: json(ConfiguracionRestauranteSchema), description: 'Configuración como quedó' },
    400: { content: json(ErrorConfiguracionSchema), description: 'Modo de pago no válido' },
    ...errores,
  },
});

const ERROR_LEER = 'No se pudo leer la configuración. Intenta de nuevo en un momento.';
const ERROR_GUARDAR = 'No se pudo cambiar el modo de pago. Intenta de nuevo en un momento.';

export function registrarConfiguracion(app: OpenAPIHono<AppEnv>, deps: DependenciasConfiguracion) {
  app.openapi(leerConfiguracionRoute, async (c) => {
    try {
      return c.json(await obtenerConfiguracion(deps.crearRepoConfiguracion(c.env)), 200);
    } catch (error) {
      console.error('GET /admin/configuracion', error);
      return c.json({ error: ERROR_LEER }, 500);
    }
  });

  app.openapi(
    cambiarConfiguracionRoute,
    async (c) => {
      const { modoPago } = c.req.valid('json');
      // Quién lo cambia sale de la sesión, nunca del cuerpo.
      const { sub } = c.get('sesion');
      try {
        const configuracion = await cambiarModoPago(
          deps.crearRepoConfiguracion(c.env),
          modoPago,
          sub,
        );
        return c.json(configuracion, 200);
      } catch (error) {
        console.error('PATCH /admin/configuracion', error);
        return c.json({ error: ERROR_GUARDAR }, 500);
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json({ error: 'El modo de pago debe ser "al_recoger" o "transferencia".' }, 400);
      }
    },
  );
}
