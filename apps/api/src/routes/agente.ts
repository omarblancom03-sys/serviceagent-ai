import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  BuscarMenuPeticionSchema,
  ErrorBusquedaSchema,
  RespuestaBuscarMenuSchema,
} from '@serviceagent/shared';
import type { AppEnv, Bindings } from '../lib/env';
import { requiereFirmaRetell } from '../lib/firmaRetell';
import { buscarEnMenu, type Embedder, type EmbeddingsRepo } from '../services/busquedaMenu';
import { errorDeFormato, FIRMA_RETELL, json } from './funcionesRetell';
import type { DependenciasMenu } from './menu';

/** Buscar lee el mismo menú que `GET /menu` y cotizar, más los embeddings y Workers AI. */
export type DependenciasAgente = DependenciasMenu & {
  crearRepoEmbeddings: (env: Bindings) => EmbeddingsRepo;
  /** `null` si el Worker no tiene el binding `AI` (Workers AI). */
  crearEmbedder: (env: Bindings) => Embedder | null;
};

const ERROR_BUSQUEDA = { error: 'No se pudo buscar en el menú. Intenta de nuevo en un momento.' };

export const buscarMenuRoute = createRoute({
  method: 'post',
  path: '/agente/buscar-menu',
  tags: ['Agente'],
  summary: 'Busca en el menú con las palabras del cliente (custom function `buscar_menu`)',
  description:
    FIRMA_RETELL +
    'Búsqueda semántica (RAG, D50): convierte la consulta en embedding con Workers AI y devuelve ' +
    'hasta 5 platillos visibles del menú, del más parecido al menos parecido, con sus precios y ' +
    'disponibilidad leídos de la base en ese momento. Si nada se parece lo suficiente, ' +
    '`resultados` viene vacía. Antes de buscar reindexa los platillos que cambiaron.',
  security: [{ FirmaRetell: [] }],
  middleware: [requiereFirmaRetell()] as const,
  request: { body: { content: json(BuscarMenuPeticionSchema), required: true } },
  responses: {
    200: {
      content: json(RespuestaBuscarMenuSchema),
      description: 'Platillos encontrados (puede venir vacía)',
    },
    400: { content: json(ErrorBusquedaSchema), description: 'Cuerpo mal formado' },
    401: { content: json(ErrorBusquedaSchema), description: 'Firma de Retell ausente o inválida' },
    500: {
      content: json(ErrorBusquedaSchema),
      description:
        'Falta `RETELL_API_KEY` o el binding `AI`, o falló Workers AI o la lectura de la base',
    },
  },
});

export function registrarAgente(app: OpenAPIHono<AppEnv>, deps: DependenciasAgente) {
  app.openapi(
    buscarMenuRoute,
    async (c) => {
      const { args } = c.req.valid('json');
      const embedder = deps.crearEmbedder(c.env);
      if (!embedder) {
        console.error('POST /agente/buscar-menu: falta el binding AI (Workers AI)');
        return c.json(ERROR_BUSQUEDA, 500);
      }
      try {
        const respuesta = await buscarEnMenu(
          deps.crearRepoMenu(c.env),
          deps.crearRepoEmbeddings(c.env),
          embedder,
          args.consulta,
        );
        return c.json(respuesta, 200);
      } catch (error) {
        console.error('POST /agente/buscar-menu', error);
        return c.json(ERROR_BUSQUEDA, 500);
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json(errorDeFormato('buscar_menu', resultado.error.issues), 400);
      }
    },
  );
}
