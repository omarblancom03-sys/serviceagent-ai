import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CotizarPedidoPeticionSchema,
  CrearPedidoPeticionSchema,
  ErrorPedidoSchema,
  RespuestaCotizarPedidoSchema,
  RespuestaCrearPedidoSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv, Bindings } from '../lib/env';
import { requiereFirmaRetell } from '../lib/firmaRetell';
import { obtenerCotizacion } from '../services/cotizacion';
import { crearPedido, type PedidosRepo } from '../services/pedido';
import type { DependenciasMenu } from './menu';

/** Cotizar y crear leen el mismo menú que `GET /menu`: usan el mismo repo. */
export type DependenciasPedidos = DependenciasMenu & {
  crearRepoPedidos: (env: Bindings) => PedidosRepo;
};

const tags = ['Pedidos'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const FIRMA_RETELL =
  'Solo para Retell: exige `X-Retell-Signature` (firma del cuerpo con `RETELL_API_KEY`). ';

const respuestasDeError = (al: string) => ({
  400: { content: json(ErrorPedidoSchema), description: 'Cuerpo mal formado' },
  401: { content: json(ErrorPedidoSchema), description: 'Firma de Retell ausente o inválida' },
  500: {
    content: json(ErrorPedidoSchema),
    description: `Falta \`RETELL_API_KEY\` o falló ${al}`,
  },
});

/**
 * Texto del 400: mismo formato de error que el resto de la API. Nombra los campos que fallaron
 * (sin sus valores), para que el agente pueda corregir la llamada. Con una llave que no existe, zod
 * pone la ruta en el padre y la llave en `keys`: se nombra "args.totalCentavos", no "args".
 */
function errorDeFormato(
  funcion: string,
  issues: { code: string; path: PropertyKey[]; keys?: string[] }[],
) {
  const campos = [
    ...new Set(
      issues.flatMap((i) =>
        i.code === 'unrecognized_keys' && i.keys
          ? i.keys.map((llave) => [...i.path, llave].join('.'))
          : [i.path.join('.') || 'cuerpo'],
      ),
    ),
  ].slice(0, 5);
  return {
    error: `La petición de ${funcion} no tiene el formato esperado. Revisa: ${campos.join(', ')}.`,
  };
}

export const cotizarPedidoRoute = createRoute({
  method: 'post',
  path: '/pedidos/cotizar',
  tags,
  summary: 'Cotiza un pedido (custom function `cotizar_pedido` del agente)',
  description:
    FIRMA_RETELL +
    'No guarda nada. Resuelve los nombres tal como los dijo el cliente y calcula el total con ' +
    'precios de la base, en centavos. Si algo no existe, es ambiguo o no se puede, responde 200 ' +
    'con `ok: false` y todas las aclaraciones juntas; nunca cotiza una parte del pedido.',
  security: [{ FirmaRetell: [] }],
  middleware: [requiereFirmaRetell()] as const,
  request: { body: { content: json(CotizarPedidoPeticionSchema), required: true } },
  responses: {
    200: {
      content: json(RespuestaCotizarPedidoSchema),
      description: 'Cotización con renglones y total, o las aclaraciones que hacen falta',
    },
    ...respuestasDeError('la lectura del menú'),
  },
});

export const crearPedidoRoute = createRoute({
  method: 'post',
  path: '/pedidos',
  tags,
  summary: 'Crea el pedido confirmado (custom function `crear_pedido` del agente)',
  description:
    FIRMA_RETELL +
    'Recibe el mismo pedido que se cotizó más nombre y teléfono, y lo VUELVE a cotizar con ' +
    'precios de la base: nunca recibe montos. Si no falta nada, guarda el pedido con folio y ' +
    'estado `confirmado` en una sola transacción. Si algo del pedido o del cliente no sirve, ' +
    'responde 200 con `ok: false` y no guarda nada. El mismo pedido con el mismo teléfono y ' +
    'nombre en los últimos 10 minutos devuelve el folio que ya existe (`yaExistia: true`).',
  security: [{ FirmaRetell: [] }],
  middleware: [requiereFirmaRetell()] as const,
  request: { body: { content: json(CrearPedidoPeticionSchema), required: true } },
  responses: {
    200: {
      content: json(RespuestaCrearPedidoSchema),
      description: 'Pedido guardado (o el que ya existía), o las aclaraciones que hacen falta',
    },
    ...respuestasDeError('la lectura del menú o al guardar'),
  },
});

export function registrarPedidos(app: OpenAPIHono<AppEnv>, deps: DependenciasPedidos) {
  app.openapi(
    cotizarPedidoRoute,
    async (c) => {
      const { args } = c.req.valid('json');
      try {
        return c.json(await obtenerCotizacion(deps.crearRepoMenu(c.env), args), 200);
      } catch (error) {
        console.error('POST /pedidos/cotizar', error);
        return c.json(
          { error: 'No se pudo cotizar el pedido. Intenta de nuevo en un momento.' },
          500,
        );
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json(errorDeFormato('cotizar_pedido', resultado.error.issues), 400);
      }
    },
  );

  app.openapi(
    crearPedidoRoute,
    async (c) => {
      const { args } = c.req.valid('json');
      try {
        const respuesta = await crearPedido(
          deps.crearRepoMenu(c.env),
          deps.crearRepoPedidos(c.env),
          args,
        );
        return c.json(respuesta, 200);
      } catch (error) {
        console.error('POST /pedidos', error);
        return c.json(
          { error: 'No se pudo registrar el pedido. Intenta de nuevo en un momento.' },
          500,
        );
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json(errorDeFormato('crear_pedido', resultado.error.issues), 400);
      }
    },
  );
}
