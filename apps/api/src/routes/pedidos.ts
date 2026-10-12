import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  CotizarPedidoPeticionSchema,
  ErrorPedidoSchema,
  RespuestaCotizarPedidoSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { requiereFirmaRetell } from '../lib/firmaRetell';
import { obtenerCotizacion } from '../services/cotizacion';
import type { DependenciasMenu } from './menu';

/** Cotizar lee el mismo menú que `GET /menu`: usa el mismo repo. */
export type DependenciasPedidos = DependenciasMenu;

const tags = ['Pedidos'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

export const cotizarPedidoRoute = createRoute({
  method: 'post',
  path: '/pedidos/cotizar',
  tags,
  summary: 'Cotiza un pedido (custom function `cotizar_pedido` del agente)',
  description:
    'Solo para Retell: exige `X-Retell-Signature` (firma del cuerpo con `RETELL_API_KEY`). ' +
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
    400: { content: json(ErrorPedidoSchema), description: 'Cuerpo mal formado' },
    401: { content: json(ErrorPedidoSchema), description: 'Firma de Retell ausente o inválida' },
    500: {
      content: json(ErrorPedidoSchema),
      description: 'Falta `RETELL_API_KEY` o falló la lectura del menú',
    },
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
    // Mismo formato de error que el resto de la API. Nombra los campos que fallaron (sin sus
    // valores), para que el agente pueda corregir la llamada. Con una llave que no existe, zod
    // pone la ruta en el padre y la llave en `keys`: se nombra "args.totalCentavos", no "args".
    (resultado, c) => {
      if (!resultado.success) {
        const campos = [
          ...new Set(
            resultado.error.issues.flatMap((i) =>
              i.code === 'unrecognized_keys'
                ? i.keys.map((llave) => [...i.path, llave].join('.'))
                : [i.path.join('.') || 'cuerpo'],
            ),
          ),
        ].slice(0, 5);
        return c.json(
          {
            error: `La petición de cotizar_pedido no tiene el formato esperado. Revisa: ${campos.join(', ')}.`,
          },
          400,
        );
      }
    },
  );
}
