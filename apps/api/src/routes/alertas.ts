import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorAlertaSchema,
  ParamsAlertaSchema,
  RespuestaAlertaAtendidaSchema,
  RespuestaAlertasPendientesSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import { requiereRol } from '../lib/auth';
import type { AppEnv, Bindings } from '../lib/env';
import { atenderAlerta, obtenerAlertasPendientes, type AlertasRepo } from '../services/alerta';

export interface DependenciasAlertas {
  crearRepoAlertas: (env: Bindings) => AlertasRepo;
}

const tags = ['Caja'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const respuestasSesion = {
  401: { content: json(ErrorAlertaSchema), description: 'Sin sesión o sesión vencida' },
  403: { content: json(ErrorAlertaSchema), description: 'El rol no es caja ni admin' },
};

export const alertasPendientesRoute = createRoute({
  method: 'get',
  path: '/caja/alertas',
  tags,
  summary: 'Alertas "Cliente requiere atención" pendientes (pantalla /caja)',
  description:
    'Rol `caja` (y `admin`). Solo las alertas que nadie ha atendido, de la más antigua a la más ' +
    'nueva. Por alerta: id, teléfono completo (para llamar al cliente; excepción a D54, D59), ' +
    'nombre, folio y motivo. Nunca el id del chat de Retell. La pantalla la vuelve a pedir ' +
    "cuando llega la señal de Realtime (canal 'pedidos', evento 'alerta').",
  security: [{ Bearer: [] }],
  middleware: [requiereRol('caja')] as const,
  responses: {
    200: { content: json(RespuestaAlertasPendientesSchema), description: 'Alertas pendientes' },
    ...respuestasSesion,
    500: { content: json(ErrorAlertaSchema), description: 'Error al leer las alertas' },
  },
});

export const atenderAlertaRoute = createRoute({
  method: 'post',
  path: '/caja/alertas/{idAlerta}/atender',
  tags,
  summary: 'Marcar una alerta como atendida',
  description:
    'Rol `caja` (y `admin`). Sin cuerpo. Marca la alerta a nombre del empleado de la sesión, solo ' +
    'si sigue pendiente; la hora la pone Postgres (D42). La respuesta no trae el teléfono (D59). ' +
    'La señal de Realtime avisa a las demás pantallas.',
  security: [{ Bearer: [] }],
  middleware: [requiereRol('caja')] as const,
  request: { params: ParamsAlertaSchema },
  responses: {
    200: { content: json(RespuestaAlertaAtendidaSchema), description: 'Alerta atendida' },
    400: {
      content: json(ErrorAlertaSchema),
      description: 'El id de la alerta no es un entero positivo',
    },
    ...respuestasSesion,
    404: { content: json(ErrorAlertaSchema), description: 'No existe una alerta con ese id' },
    409: { content: json(ErrorAlertaSchema), description: 'La alerta ya estaba atendida' },
    500: { content: json(ErrorAlertaSchema), description: 'Error al guardar el cambio' },
  },
});

// Textos para la pantalla de caja: en español y sin detalles técnicos.
const ERROR_ID = { error: 'El id de la alerta debe ser un entero positivo.' };
const ERROR_NO_EXISTE = { error: 'No encontramos esa alerta.' };
const ERROR_YA_ATENDIDA = { error: 'Otro empleado ya atendió esta alerta.' };

export function registrarAlertas(app: OpenAPIHono<AppEnv>, deps: DependenciasAlertas) {
  app.openapi(alertasPendientesRoute, async (c) => {
    try {
      const alertas = await obtenerAlertasPendientes(deps.crearRepoAlertas(c.env));
      return c.json({ alertas }, 200);
    } catch (error) {
      console.error('GET /caja/alertas', error);
      return c.json(
        { error: 'No se pudieron leer las alertas. Intenta de nuevo en un momento.' },
        500,
      );
    }
  });

  app.openapi(
    atenderAlertaRoute,
    async (c) => {
      const { idAlerta } = c.req.valid('param');
      try {
        // Quién la atendió sale de la sesión, nunca del cuerpo.
        const resultado = await atenderAlerta(
          deps.crearRepoAlertas(c.env),
          idAlerta,
          c.get('sesion').sub,
        );
        if (resultado.tipo === 'no_encontrada') return c.json(ERROR_NO_EXISTE, 404);
        if (resultado.tipo === 'ya_atendida') return c.json(ERROR_YA_ATENDIDA, 409);
        return c.json(resultado.respuesta, 200);
      } catch (error) {
        console.error('POST /caja/alertas/{idAlerta}/atender', error);
        return c.json(
          { error: 'No se pudo guardar el cambio. Intenta de nuevo en un momento.' },
          500,
        );
      }
    },
    (resultado, c) => {
      if (!resultado.success) return c.json(ERROR_ID, 400);
    },
  );
}
