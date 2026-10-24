import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ConflictoCocinaSchema,
  DeshacerCambioCocinaPeticionSchema,
  ErrorCocinaSchema,
  ParamsFolioCocinaSchema,
  RespuestaCambioEstadoCocinaSchema,
  RespuestaDeshacerCocinaSchema,
  RespuestaPedidosCocinaSchema,
  SEGUNDOS_DESHACER_PANTALLA,
  SEGUNDOS_DESHACER_SERVIDOR,
} from '@serviceagent/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import { requiereRol } from '../lib/auth';
import type { AppEnv, Bindings } from '../lib/env';
import {
  cambiarEstadoCocina,
  deshacerCambioCocina,
  obtenerPedidosCocina,
  type AccionCocina,
  type CocinaRepo,
} from '../services/cocina';

export interface DependenciasCocina {
  crearRepoCocina: (env: Bindings) => CocinaRepo;
}

const tags = ['Cocina'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

export const pedidosCocinaRoute = createRoute({
  method: 'get',
  path: '/cocina/pedidos',
  tags,
  summary: 'Pedidos que cocina debe preparar (pantalla /cocina)',
  description:
    "Rol `cocina` (y `admin`). Pedidos en 'en_cola' o 'preparando', del más antiguo al más nuevo " +
    'según la hora en que entraron a la cola. Solo lo que cocina necesita: folio, nombre, ' +
    'platillos con variante, ingredientes quitados y extras; sin precios ni teléfono. La pantalla ' +
    "lo vuelve a pedir cuando llega la señal de Realtime (canal 'pedidos', evento 'cambio', D12).",
  security: [{ Bearer: [] }],
  middleware: [requiereRol('cocina')] as const,
  responses: {
    200: { content: json(RespuestaPedidosCocinaSchema), description: 'Tickets de cocina' },
    401: { content: json(ErrorCocinaSchema), description: 'Sin sesión o sesión vencida' },
    403: { content: json(ErrorCocinaSchema), description: 'El rol no es cocina ni admin' },
    500: { content: json(ErrorCocinaSchema), description: 'Error al leer los pedidos' },
  },
});

// Respuestas comunes de Empezar, Terminado y Deshacer (US-11-P1, D56).
const respuestasCambio = {
  400: {
    content: json(ErrorCocinaSchema),
    description: 'El folio no es un entero positivo o el cuerpo no es válido',
  },
  401: { content: json(ErrorCocinaSchema), description: 'Sin sesión o sesión vencida' },
  403: { content: json(ErrorCocinaSchema), description: 'El rol no es cocina ni admin' },
  404: { content: json(ErrorCocinaSchema), description: 'No existe un pedido con ese folio' },
  500: { content: json(ErrorCocinaSchema), description: 'Error al guardar el cambio' },
};

const crearRutaCambio = (accion: AccionCocina, desde: string, hacia: string, boton: string) =>
  createRoute({
    method: 'post',
    path: `/cocina/pedidos/{folio}/${accion}`,
    tags,
    summary: `Botón ${boton}: ${desde} → ${hacia}`,
    description:
      `Rol \`cocina\` (y \`admin\`). Pasa el pedido de '${desde}' a '${hacia}' solo si sigue en ` +
      `'${desde}'; guarda en el historial la hora (Postgres, D42) y el empleado de la sesión. ` +
      `\`deshacerHasta\` = \`cambiadoEn\` + ${SEGUNDOS_DESHACER_PANTALLA} s: hasta cuándo la ` +
      'pantalla ofrece Deshacer. La señal de Realtime avisa a las demás pantallas (D47).',
    security: [{ Bearer: [] }],
    middleware: [requiereRol('cocina')] as const,
    request: { params: ParamsFolioCocinaSchema },
    responses: {
      200: { content: json(RespuestaCambioEstadoCocinaSchema), description: 'Estado cambiado' },
      ...respuestasCambio,
      409: {
        content: json(ConflictoCocinaSchema),
        description: `\`estado_cambio\`: el pedido ya no está en '${desde}' (trae \`estadoActual\`)`,
      },
    },
  });

export const empezarPedidoRoute = crearRutaCambio('empezar', 'en_cola', 'preparando', 'Empezar');
export const terminarPedidoRoute = crearRutaCambio('terminar', 'preparando', 'listo', 'Terminado');

export const deshacerCambioRoute = createRoute({
  method: 'post',
  path: '/cocina/pedidos/{folio}/deshacer',
  tags,
  summary: 'Deshacer Empezar o Terminado',
  description:
    "Rol `cocina` (y `admin`). `estado` = 'preparando' regresa el pedido a 'en_cola' (deshace " +
    "Empezar); 'listo' lo regresa a 'preparando' (deshace Terminado). Solo si ese estado es el " +
    `último cambio del pedido y pasaron a lo más ${SEGUNDOS_DESHACER_SERVIDOR} s. Borra esa fila ` +
    'del historial: la hora de entrada a la cola no cambia.',
  security: [{ Bearer: [] }],
  middleware: [requiereRol('cocina')] as const,
  request: {
    params: ParamsFolioCocinaSchema,
    body: { content: json(DeshacerCambioCocinaPeticionSchema), required: true },
  },
  responses: {
    200: { content: json(RespuestaDeshacerCocinaSchema), description: 'Cambio deshecho' },
    ...respuestasCambio,
    409: {
      content: json(ConflictoCocinaSchema),
      description:
        '`estado_cambio`: ese estado no es el último cambio del pedido; `plazo_vencido`: ya ' +
        'pasó el plazo (trae `estadoActual`)',
    },
  },
});

// Textos para la pantalla de cocina: en español y sin detalles técnicos.
const ERROR_FOLIO = { error: 'El folio debe ser un entero positivo.' };
const ERROR_CUERPO = { error: 'Indica qué estado quieres deshacer: preparando o listo.' };
/** 400 de un cuerpo que no es JSON válido en `/cocina/*` (lo usa el `onError` de `index.ts`). */
export const ERROR_PETICION_COCINA = { error: 'La petición no es válida.' };
const ERROR_NO_EXISTE = { error: 'No encontramos un pedido con ese folio.' };
const ERROR_GUARDAR = { error: 'No se pudo guardar el cambio. Intenta de nuevo en un momento.' };

/** Si el folio o el cuerpo no son válidos, responde con el formato de error de cocina. */
function validarCambio(resultado: { success: boolean; target: string }, c: Context<AppEnv>) {
  if (!resultado.success) {
    return c.json(resultado.target === 'param' ? ERROR_FOLIO : ERROR_CUERPO, 400);
  }
}

export function registrarCocina(app: OpenAPIHono<AppEnv>, deps: DependenciasCocina) {
  app.openapi(pedidosCocinaRoute, async (c) => {
    try {
      const pedidos = await obtenerPedidosCocina(deps.crearRepoCocina(c.env));
      return c.json({ pedidos }, 200);
    } catch (error) {
      console.error('GET /cocina/pedidos', error);
      return c.json(
        { error: 'No se pudieron leer los pedidos. Intenta de nuevo en un momento.' },
        500,
      );
    }
  });

  const rutasCambio = [
    ['empezar', empezarPedidoRoute],
    ['terminar', terminarPedidoRoute],
  ] as const;
  for (const [accion, ruta] of rutasCambio) {
    app.openapi(
      ruta,
      async (c) => {
        const { folio } = c.req.valid('param');
        try {
          // Quién hizo el cambio sale de la sesión, nunca del cuerpo.
          const resultado = await cambiarEstadoCocina(
            deps.crearRepoCocina(c.env),
            accion,
            folio,
            c.get('sesion').sub,
          );
          if (resultado.tipo === 'no_existe') return c.json(ERROR_NO_EXISTE, 404);
          if (resultado.tipo === 'conflicto') return c.json(resultado.conflicto, 409);
          return c.json(resultado.respuesta, 200);
        } catch (error) {
          console.error(`POST /cocina/pedidos/{folio}/${accion}`, error);
          return c.json(ERROR_GUARDAR, 500);
        }
      },
      validarCambio,
    );
  }

  app.openapi(
    deshacerCambioRoute,
    async (c) => {
      const { folio } = c.req.valid('param');
      const { estado } = c.req.valid('json');
      try {
        const resultado = await deshacerCambioCocina(deps.crearRepoCocina(c.env), folio, estado);
        if (resultado.tipo === 'no_existe') return c.json(ERROR_NO_EXISTE, 404);
        if (resultado.tipo === 'conflicto') return c.json(resultado.conflicto, 409);
        return c.json(resultado.respuesta, 200);
      } catch (error) {
        console.error('POST /cocina/pedidos/{folio}/deshacer', error);
        return c.json(ERROR_GUARDAR, 500);
      }
    },
    validarCambio,
  );
}
