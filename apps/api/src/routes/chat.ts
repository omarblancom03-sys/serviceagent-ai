import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  EnviarMensajePeticionSchema,
  ErrorChatSchema,
  ParamsConversacionSchema,
  RespuestaEnviarMensajeSchema,
  RespuestaIniciarConversacionSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv } from '../lib/env';

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

/** Solo documenta el contrato en Swagger: Retell se conecta en el siguiente PR de US-09-P1. */
export function registrarChat(app: OpenAPIHono<AppEnv>) {
  app.openAPIRegistry.registerPath(iniciarConversacionRoute);
  app.openAPIRegistry.registerPath(enviarMensajeRoute);
}
