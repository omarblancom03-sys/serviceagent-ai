import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CobrarPedidoPeticionSchema,
  ConflictoCajaSchema,
  ErrorCajaSchema,
  ParamsFolioCajaSchema,
  RespuestaCobroCajaSchema,
  RespuestaEntregaCajaSchema,
  RespuestaPedidosCajaSchema,
} from '@serviceagent/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import { requiereRol } from '../lib/auth';
import type { AppEnv, Bindings } from '../lib/env';
import {
  cobrarPedidoCaja,
  entregarPedidoCaja,
  obtenerPedidosCaja,
  type CajaRepo,
} from '../services/caja';

export interface DependenciasCaja {
  crearRepoCaja: (env: Bindings) => CajaRepo;
}

const tags = ['Caja'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

export const pedidosCajaRoute = createRoute({
  method: 'get',
  path: '/caja/pedidos',
  tags,
  summary: 'Pedidos del día para cobrar y entregar (pantalla /caja)',
  description:
    'Rol `caja` (y `admin`). Pedidos creados hoy (día de America/Chihuahua) y los de días ' +
    'anteriores que siguen abiertos, del folio menor al mayor. Por pedido: folio, nombre, ' +
    'últimos 4 dígitos del teléfono, estado y desde cuándo, total, si ya está pagado y con qué, ' +
    'y lo que falta por cobrar (`porCobrarCentavos`). ' +
    "La pantalla lo vuelve a pedir cuando llega la señal de Realtime (canal 'pedidos', evento " +
    "'cambio', D12), que también se manda al registrar un pago.",
  security: [{ Bearer: [] }],
  middleware: [requiereRol('caja')] as const,
  responses: {
    200: { content: json(RespuestaPedidosCajaSchema), description: 'Pedidos de caja' },
    401: { content: json(ErrorCajaSchema), description: 'Sin sesión o sesión vencida' },
    403: { content: json(ErrorCajaSchema), description: 'El rol no es caja ni admin' },
    500: { content: json(ErrorCajaSchema), description: 'Error al leer los pedidos' },
  },
});

// Respuestas comunes de Cobrar y Entregado (US-21, D66).
const respuestasAccion = {
  400: {
    content: json(ErrorCajaSchema),
    description: 'El folio no es un entero positivo o el cuerpo no es válido',
  },
  401: { content: json(ErrorCajaSchema), description: 'Sin sesión o sesión vencida' },
  403: { content: json(ErrorCajaSchema), description: 'El rol no es caja ni admin' },
  404: { content: json(ErrorCajaSchema), description: 'No existe un pedido con ese folio' },
  500: { content: json(ErrorCajaSchema), description: 'Error al guardar' },
};

export const cobrarPedidoRoute = createRoute({
  method: 'post',
  path: '/caja/pedidos/{folio}/cobrar',
  tags,
  summary: 'Botón Cobrar: registra el pago en efectivo o con tarjeta',
  description:
    'Rol `caja` (y `admin`). Registra UN pago por lo que falta del total del pedido, con el ' +
    'método del cuerpo (`efectivo` o `tarjeta`). **Nunca recibe un monto**: lo calcula la base ' +
    '(total menos lo ya pagado) y lo devuelve en `montoCentavos`. Guarda la hora (Postgres, D42) ' +
    'y el empleado de la sesión. Solo cobra pedidos en `en_cola`, `preparando` o `listo` que no ' +
    'estén pagados; la base bloquea el pedido, así que dos cajas a la vez no lo cobran dos ' +
    'veces. La señal de Realtime avisa a las demás pantallas (D47).',
  security: [{ Bearer: [] }],
  middleware: [requiereRol('caja')] as const,
  request: {
    params: ParamsFolioCajaSchema,
    body: { content: json(CobrarPedidoPeticionSchema), required: true },
  },
  responses: {
    200: { content: json(RespuestaCobroCajaSchema), description: 'Pago registrado' },
    ...respuestasAccion,
    409: {
      content: json(ConflictoCajaSchema),
      description:
        '`ya_pagado`: sus pagos ya cubren el total; `estado_no_cobrable`: está cancelado, ' +
        'expirado o entregado, o espera una transferencia. Siempre trae `estadoActual`',
    },
  },
});

export const entregarPedidoRoute = createRoute({
  method: 'post',
  path: '/caja/pedidos/{folio}/entregar',
  tags,
  summary: 'Botón Entregado: listo → entregado',
  description:
    "Rol `caja` (y `admin`), sin cuerpo. Pasa el pedido de 'listo' a 'entregado' solo si sigue " +
    "en 'listo' y ya está pagado; guarda en el historial la hora de la entrega (Postgres, D42) y " +
    'el empleado de la sesión. No tiene Deshacer. La señal de Realtime avisa a las demás ' +
    'pantallas (D47): el pedido sale de Terminados recientes de cocina (D63).',
  security: [{ Bearer: [] }],
  middleware: [requiereRol('caja')] as const,
  request: { params: ParamsFolioCajaSchema },
  responses: {
    200: { content: json(RespuestaEntregaCajaSchema), description: 'Pedido entregado' },
    ...respuestasAccion,
    400: { content: json(ErrorCajaSchema), description: 'El folio no es un entero positivo' },
    409: {
      content: json(ConflictoCajaSchema),
      description:
        "`estado_cambio`: ya no está en 'listo' (otra caja lo entregó, cocina lo regresó o se " +
        'canceló); `falta_pago`: está listo pero no se ha cobrado. Siempre trae `estadoActual`',
    },
  },
});

// Textos para la pantalla de caja: en español y sin detalles técnicos.
const ERROR_FOLIO = { error: 'El folio debe ser un entero positivo.' };
const ERROR_CUERPO = { error: 'Indica con qué se cobra: efectivo o tarjeta.' };
/** 400 de un cuerpo que no es JSON válido en `/caja/*` (lo usa el `onError` de `index.ts`). */
export const ERROR_PETICION_CAJA = { error: 'La petición no es válida.' };
const ERROR_NO_EXISTE = { error: 'No encontramos un pedido con ese folio.' };
const ERROR_GUARDAR = { error: 'No se pudo guardar. Intenta de nuevo en un momento.' };

/** Si el folio o el cuerpo no son válidos, responde con el formato de error de caja. */
function validarAccion(resultado: { success: boolean; target: string }, c: Context<AppEnv>) {
  if (!resultado.success) {
    return c.json(resultado.target === 'param' ? ERROR_FOLIO : ERROR_CUERPO, 400);
  }
}

export function registrarCaja(app: OpenAPIHono<AppEnv>, deps: DependenciasCaja) {
  app.openapi(pedidosCajaRoute, async (c) => {
    try {
      const pedidos = await obtenerPedidosCaja(deps.crearRepoCaja(c.env));
      return c.json({ pedidos }, 200);
    } catch (error) {
      console.error('GET /caja/pedidos', error);
      return c.json(
        { error: 'No se pudieron leer los pedidos. Intenta de nuevo en un momento.' },
        500,
      );
    }
  });

  app.openapi(
    cobrarPedidoRoute,
    async (c) => {
      const { folio } = c.req.valid('param');
      const { metodo } = c.req.valid('json');
      try {
        // Quién cobra sale de la sesión, nunca del cuerpo.
        const resultado = await cobrarPedidoCaja(
          deps.crearRepoCaja(c.env),
          folio,
          metodo,
          c.get('sesion').sub,
        );
        if (resultado.tipo === 'no_existe') return c.json(ERROR_NO_EXISTE, 404);
        if (resultado.tipo === 'conflicto') return c.json(resultado.conflicto, 409);
        return c.json(resultado.respuesta, 200);
      } catch (error) {
        console.error('POST /caja/pedidos/{folio}/cobrar', error);
        return c.json(ERROR_GUARDAR, 500);
      }
    },
    validarAccion,
  );

  app.openapi(
    entregarPedidoRoute,
    async (c) => {
      const { folio } = c.req.valid('param');
      try {
        // Quién entrega sale de la sesión, nunca del cuerpo.
        const resultado = await entregarPedidoCaja(
          deps.crearRepoCaja(c.env),
          folio,
          c.get('sesion').sub,
        );
        if (resultado.tipo === 'no_existe') return c.json(ERROR_NO_EXISTE, 404);
        if (resultado.tipo === 'conflicto') return c.json(resultado.conflicto, 409);
        return c.json(resultado.respuesta, 200);
      } catch (error) {
        console.error('POST /caja/pedidos/{folio}/entregar', error);
        return c.json(ERROR_GUARDAR, 500);
      }
    },
    validarAccion,
  );
}
