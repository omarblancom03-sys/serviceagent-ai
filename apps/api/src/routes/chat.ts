import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  EnviarMensajePeticionSchema,
  ErrorChatSchema,
  ParamsConversacionSchema,
  RespuestaEnviarMensajeSchema,
  RespuestaIniciarConversacionSchema,
  type ErrorChat,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv, Bindings } from '../lib/env';
import {
  enviarMensaje,
  iniciarConversacion,
  leerConfigChat,
  type ChatRepo,
  type ClienteRetell,
} from '../services/chat';

const tags = ['Chat'];
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const error503 = {
  content: json(ErrorChatSchema),
  description:
    '`servicio_no_disponible`: el agente no responde (falla, tarda o no está configurado). Sin detalles técnicos.',
};

const error503Iniciar = {
  content: json(ErrorChatSchema),
  description:
    '`servicio_no_disponible`: Retell caído, sin saldo o sin configuración, o tope diario de conversaciones nuevas alcanzado. ' +
    'El texto del error puede variar según la causa; el código no. Sin detalles técnicos.',
};

export const iniciarConversacionRoute = createRoute({
  method: 'post',
  path: '/chat/conversaciones',
  tags,
  summary: 'Inicia una conversación con el agente',
  description:
    'Pública. La API abre el chat con el agente de Retell (la llave vive solo en el servidor, D21). ' +
    '`mensajes` trae lo que el agente escribió al abrir y puede venir vacío; `mensajesUsados` empieza en 0.',
  responses: {
    201: { content: json(RespuestaIniciarConversacionSchema), description: 'Conversación creada' },
    503: error503Iniciar,
  },
});

export const enviarMensajeRoute = createRoute({
  method: 'post',
  path: '/chat/conversaciones/{id}/mensajes',
  tags,
  summary: 'Envía un mensaje del cliente y devuelve las respuestas nuevas del agente',
  description:
    'Pública. `texto` se recorta y debe tener de 1 a 500 caracteres. ' +
    'Solo devuelve el texto de los mensajes del agente: nunca herramientas ni datos de Retell. ' +
    'La API cuenta los mensajes del cliente por conversación y rechaza el que pasa de `limiteMensajes` (D21).',
  request: {
    params: ParamsConversacionSchema,
    body: { content: json(EnviarMensajePeticionSchema), required: true },
  },
  responses: {
    200: { content: json(RespuestaEnviarMensajeSchema), description: 'Respuestas del agente' },
    400: {
      content: json(ErrorChatSchema),
      description:
        '`peticion_invalida`: texto vacío o de más de 500 caracteres, cuerpo o id mal formado',
    },
    404: {
      content: json(ErrorChatSchema),
      description: '`conversacion_no_encontrada`: no existe una conversación con ese id',
    },
    409: {
      content: json(ErrorChatSchema),
      description: '`conversacion_terminada`: la conversación ya cerró; hay que iniciar otra',
    },
    429: {
      content: json(ErrorChatSchema),
      description:
        '`limite_alcanzado`: ya se enviaron los mensajes permitidos en esta conversación',
    },
    503: error503,
  },
});

export interface DependenciasChat {
  crearRepoChat: (env: Bindings) => ChatRepo;
  crearClienteRetell: (llave: string) => ClienteRetell;
}

// Textos para el cliente: en español y sin detalles técnicos ni mensajes de Retell.
export const ERROR_PETICION_INVALIDA: ErrorChat = {
  error: 'No pudimos leer tu mensaje. Debe tener de 1 a 500 caracteres.',
  codigo: 'peticion_invalida',
};
const ERROR_NO_DISPONIBLE: ErrorChat = {
  error: 'El chat no está disponible en este momento. Intenta de nuevo en unos minutos.',
  codigo: 'servicio_no_disponible',
};
const ERROR_TOPE_DIARIO: ErrorChat = {
  error: 'El chat llegó a su límite de hoy. Intenta de nuevo mañana.',
  codigo: 'servicio_no_disponible',
};
const ERROR_NO_ENCONTRADA: ErrorChat = {
  error: 'No encontramos esta conversación. Inicia una nueva.',
  codigo: 'conversacion_no_encontrada',
};
const ERROR_TERMINADA: ErrorChat = {
  error: 'Esta conversación ya terminó. Inicia una nueva para seguir.',
  codigo: 'conversacion_terminada',
};
const ERROR_LIMITE: ErrorChat = {
  error: 'Llegaste al límite de mensajes de esta conversación. Inicia una nueva para seguir.',
  codigo: 'limite_alcanzado',
};

export function registrarChat(app: OpenAPIHono<AppEnv>, deps: DependenciasChat) {
  app.openapi(iniciarConversacionRoute, async (c) => {
    // La configuración se revisa antes de abrir la conversación: si falta, no se gasta tope.
    const { llave, agentId, topeDiario } = leerConfigChat(c.env);
    if (!llave || !agentId) {
      console.warn('POST /chat/conversaciones: falta RETELL_API_KEY o RETELL_AGENT_ID');
      return c.json(ERROR_NO_DISPONIBLE, 503);
    }
    try {
      const resultado = await iniciarConversacion(
        { repo: deps.crearRepoChat(c.env), retell: deps.crearClienteRetell(llave) },
        { agentId, topeDiario },
      );
      if (resultado.tipo === 'ok') return c.json(resultado.respuesta, 201);
      return c.json(
        resultado.tipo === 'tope_alcanzado' ? ERROR_TOPE_DIARIO : ERROR_NO_DISPONIBLE,
        503,
      );
    } catch (error) {
      console.error('POST /chat/conversaciones', error instanceof Error ? error.message : '');
      return c.json(ERROR_NO_DISPONIBLE, 503);
    }
  });

  app.openapi(
    enviarMensajeRoute,
    async (c) => {
      const { id } = c.req.valid('param');
      const { texto } = c.req.valid('json');
      const { llave } = leerConfigChat(c.env);
      if (!llave) {
        console.warn('POST /chat/conversaciones/{id}/mensajes: falta RETELL_API_KEY');
        return c.json(ERROR_NO_DISPONIBLE, 503);
      }
      try {
        const resultado = await enviarMensaje(
          { repo: deps.crearRepoChat(c.env), retell: deps.crearClienteRetell(llave) },
          { id, texto },
        );
        switch (resultado.tipo) {
          case 'ok':
            return c.json(resultado.respuesta, 200);
          case 'no_encontrada':
            return c.json(ERROR_NO_ENCONTRADA, 404);
          case 'terminada':
            return c.json(ERROR_TERMINADA, 409);
          case 'limite_alcanzado':
            return c.json(ERROR_LIMITE, 429);
          case 'no_disponible':
            return c.json(ERROR_NO_DISPONIBLE, 503);
        }
      } catch (error) {
        console.error(
          'POST /chat/conversaciones/{id}/mensajes',
          error instanceof Error ? error.message : '',
        );
        return c.json(ERROR_NO_DISPONIBLE, 503);
      }
    },
    // Id que no es uuid, cuerpo con otra forma o texto fuera de 1 a 500 caracteres. El JSON mal
    // formado lo rechaza Hono antes de llegar aquí; lo traduce el `onError` de index.ts.
    (resultado, c) => {
      if (!resultado.success) return c.json(ERROR_PETICION_INVALIDA, 400);
    },
  );
}
