import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  EmpleadoPublicoSchema,
  ErrorAuthSchema,
  LoginSchema,
  SesionActualSchema,
  SesionSchema,
} from '@serviceagent/shared';
import { z } from 'zod';
import { duracionEnSegundos, firmarToken, leerSecreto, requiereRol } from '../lib/auth';
import { leerPepper } from '../lib/pin';
import type { AppEnv, Bindings } from '../lib/env';
import {
  iniciarSesion,
  listarEmpleados,
  obtenerEmpleadoDeSesion,
  type EmpleadosRepo,
} from '../services/sesion';

export interface DependenciasAuth {
  crearRepoEmpleados: (env: Bindings) => EmpleadosRepo;
}

const tags = ['Autenticación'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const empleadosRoute = createRoute({
  method: 'get',
  path: '/auth/empleados',
  tags,
  summary: 'Empleados activos para la pantalla de acceso',
  description: 'Pública. Solo devuelve id, nombre y rol (nunca el hash del PIN).',
  responses: {
    200: { content: json(z.array(EmpleadoPublicoSchema)), description: 'Empleados activos' },
  },
});

const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  tags,
  summary: 'Inicia sesión con PIN',
  description: `Devuelve un JWT con sub, rol y exp. Tras 5 PIN incorrectos seguidos el empleado queda bloqueado 15 minutos.`,
  request: { body: { content: json(LoginSchema), required: true } },
  responses: {
    200: { content: json(SesionSchema), description: 'PIN correcto' },
    400: { description: 'Cuerpo inválido (por ejemplo, PIN que no tiene 4 dígitos)' },
    401: { content: json(ErrorAuthSchema), description: 'PIN incorrecto' },
    423: { content: json(ErrorAuthSchema), description: 'Empleado bloqueado temporalmente' },
  },
});

const sesionRoute = createRoute({
  method: 'get',
  path: '/auth/sesion',
  tags,
  summary: 'Sesión del token actual',
  description:
    'Busca en la base al empleado del token (sub) y devuelve sus datos públicos y la expiración. ' +
    'El nombre no viaja en el JWT: la web lo obtiene aquí.',
  security: [{ Bearer: [] }],
  middleware: [requiereRol('cocina', 'caja', 'admin')] as const,
  responses: {
    200: { content: json(SesionActualSchema), description: 'Token válido y empleado activo' },
    401: {
      content: json(ErrorAuthSchema),
      description:
        'Sin token, token inválido o vencido, o empleado inexistente, dado de baja o con otro rol',
    },
  },
});

export function registrarAuth(app: OpenAPIHono<AppEnv>, deps: DependenciasAuth) {
  app.openapi(empleadosRoute, async (c) => {
    const empleados = await listarEmpleados(deps.crearRepoEmpleados(c.env));
    return c.json(empleados, 200);
  });

  app.openapi(loginRoute, async (c) => {
    // Se valida la configuración antes de tocar el contador de intentos.
    const secreto = leerSecreto(c.env.JWT_SECRET);
    const duracion = duracionEnSegundos(c.env.JWT_EXPIRES_IN);
    const pepper = leerPepper(c.env.PIN_PEPPER);

    const resultado = await iniciarSesion(
      deps.crearRepoEmpleados(c.env),
      c.req.valid('json'),
      pepper,
    );

    if (resultado.tipo === 'bloqueado') {
      const { minutosRestantes } = resultado;
      return c.json(
        {
          error: `Demasiados intentos. Intenta de nuevo en ${minutosRestantes} min.`,
          minutosRestantes,
        },
        423,
      );
    }
    if (resultado.tipo === 'pin_incorrecto') {
      return c.json(
        { error: 'PIN incorrecto.', intentosRestantes: resultado.intentosRestantes },
        401,
      );
    }

    const { empleado } = resultado;
    const { token, exp } = await firmarToken(
      { sub: empleado.id, rol: empleado.rol },
      secreto,
      duracion,
    );
    return c.json({ token, expiraEn: new Date(exp * 1000).toISOString(), empleado }, 200);
  });

  app.openapi(sesionRoute, async (c) => {
    const { sub, rol, exp } = c.get('sesion');
    const empleado = await obtenerEmpleadoDeSesion(deps.crearRepoEmpleados(c.env), { sub, rol });
    if (!empleado) {
      return c.json({ error: 'Sesión inválida o vencida. Vuelve a iniciar sesión.' }, 401);
    }
    return c.json({ empleado, exp }, 200);
  });
}
