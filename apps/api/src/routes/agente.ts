import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  BuscarMenuPeticionSchema,
  ErrorAlertaSchema,
  ErrorBusquedaSchema,
  RespuestaBuscarMenuSchema,
  RespuestaTransferirAEmpleadoSchema,
  TransferirAEmpleadoPeticionSchema,
} from '@serviceagent/shared';
import { idDelChat, llavesDelChat } from '../lib/chatRetell';
import type { AppEnv, Bindings } from '../lib/env';
import { requiereFirmaRetell } from '../lib/firmaRetell';
import { transferirAEmpleado, type AlertasRepo } from '../services/alerta';
import { buscarEnMenu, type Embedder, type EmbeddingsRepo } from '../services/busquedaMenu';
import { errorDeFormato, FIRMA_RETELL, json } from './funcionesRetell';
import type { DependenciasMenu } from './menu';

/** Buscar lee el mismo menú que `GET /menu` y cotizar, más los embeddings y Workers AI. */
export type DependenciasAgente = DependenciasMenu & {
  crearRepoEmbeddings: (env: Bindings) => EmbeddingsRepo;
  /** `null` si el Worker no tiene el binding `AI` (Workers AI). */
  crearEmbedder: (env: Bindings) => Embedder | null;
  crearRepoAlertas: (env: Bindings) => AlertasRepo;
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

const ERROR_ESCALAR = {
  error: 'No se pudo avisar a un empleado. Intenta de nuevo en un momento.',
};

export const escalarRoute = createRoute({
  method: 'post',
  path: '/agente/escalar',
  tags: ['Agente'],
  summary: 'Pide que un empleado atienda al cliente (custom function `transferir_a_empleado`)',
  description:
    FIRMA_RETELL +
    'Guarda una alerta "Cliente requiere atención" para caja y admin con el teléfono, el nombre, ' +
    'el folio y el motivo (D59). Una pendiente por conversación: si esa conversación ya tiene una ' +
    'sin atender, responde `yaSeAviso: true` sin crear otra; ya atendida, puede pedir otra. De `chat` solo se lee `chat.chat_id`; si ' +
    'no viene, responde `ok: false` con `sinConversacion: true` sin tocar la base. La ' +
    'conversación nunca se guarda. Un teléfono o nombre que no sirve, o un motivo de más de 200 ' +
    'caracteres, responde 200 con `ok: false` y lo que hay que corregir. Si el folio no existe o ' +
    'no es de ese teléfono, la alerta se guarda sin folio y responde `folioNoEncontrado: true`.',
  security: [{ FirmaRetell: [] }],
  middleware: [requiereFirmaRetell()] as const,
  request: { body: { content: json(TransferirAEmpleadoPeticionSchema), required: true } },
  responses: {
    200: {
      content: json(RespuestaTransferirAEmpleadoSchema),
      description: 'Alerta creada (o la que ya existía), o lo que hay que corregir',
    },
    400: { content: json(ErrorAlertaSchema), description: 'Cuerpo mal formado' },
    401: { content: json(ErrorAlertaSchema), description: 'Firma de Retell ausente o inválida' },
    500: {
      content: json(ErrorAlertaSchema),
      description: 'Falta `RETELL_API_KEY` o falló la base al guardar la alerta',
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

  app.openapi(
    escalarRoute,
    async (c) => {
      const { args, chat } = c.req.valid('json');
      const idChat = idDelChat(chat);
      if (idChat === null) {
        // Sin id no hay "una alerta pendiente por conversación" (D59). Solo las llaves, nunca su contenido.
        console.warn('POST /agente/escalar sin chat.chat_id', { llaves: llavesDelChat(chat) });
      }
      try {
        const respuesta = await transferirAEmpleado(deps.crearRepoAlertas(c.env), args, idChat);
        return c.json(respuesta, 200);
      } catch (error) {
        console.error('POST /agente/escalar', error);
        return c.json(ERROR_ESCALAR, 500);
      }
    },
    (resultado, c) => {
      if (!resultado.success) {
        return c.json(errorDeFormato('transferir_a_empleado', resultado.error.issues), 400);
      }
    },
  );
}
