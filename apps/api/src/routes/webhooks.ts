import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  AvisoTransferenciaSchema,
  ErrorBancoSchema,
  RespuestaWebhookBancoSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { ENCABEZADO_FIRMA_BANCO, requiereFirmaBanco } from '../lib/firmaBanco';

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

/** 400 de un aviso con firma válida pero cuerpo mal formado (también lo usa `onError`). */
export const ERROR_AVISO_BANCO = { error: 'El aviso no tiene el formato esperado.' };

export const webhookBancoRoute = createRoute({
  method: 'post',
  path: '/webhooks/banco',
  tags: ['Webhooks'],
  summary: 'Aviso del banco: llegó una transferencia',
  description:
    `Solo para el banco: exige \`${ENCABEZADO_FIRMA_BANCO}\` (HMAC del cuerpo con ` +
    '`BANCO_WEBHOOK_SECRET`). La firma se revisa antes que el cuerpo. Hoy solo recibe y valida el ' +
    'aviso (US-24, D70): no toca ningún pedido. La conciliación por referencia y monto, y el ' +
    'aviso repetido (`idTransferencia`), llegan en US-25 y US-26.',
  security: [{ FirmaBanco: [] }],
  middleware: [requiereFirmaBanco()] as const,
  request: { body: { content: json(AvisoTransferenciaSchema), required: true } },
  responses: {
    200: { content: json(RespuestaWebhookBancoSchema), description: 'Aviso recibido' },
    400: { content: json(ErrorBancoSchema), description: 'El cuerpo no tiene el formato esperado' },
    401: { content: json(ErrorBancoSchema), description: 'Firma ausente, inválida o vencida' },
    500: { content: json(ErrorBancoSchema), description: 'Falta `BANCO_WEBHOOK_SECRET`' },
  },
});

export function registrarWebhooks(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    webhookBancoRoute,
    (c) => {
      const aviso = c.req.valid('json');
      // US-25 concilia aquí el aviso con su pedido. Sin datos del cliente en el log.
      console.log('Aviso del banco recibido:', aviso.idTransferencia);
      return c.json({ recibido: true as const }, 200);
    },
    (resultado, c) => {
      if (!resultado.success) return c.json(ERROR_AVISO_BANCO, 400);
    },
  );
}
