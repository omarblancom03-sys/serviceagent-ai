import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import {
  ErrorBancoSchema,
  TransferenciaBancoPeticionSchema,
  TransferenciaBancoSchema,
} from '@serviceagent/shared';
import type { z } from 'zod';
import type { AppEnv } from '../lib/env';
import { ENCABEZADO_FIRMA_BANCO, faltaSecretoBanco } from '../lib/firmaBanco';
import { transferir } from '../services/bancoSimulado';

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

/** 400 del cuerpo (también lo usa `onError` cuando el JSON viene mal formado). */
export const ERROR_TRANSFERENCIA_BANCO = {
  error:
    'Revisa los datos: la CLABE son 18 dígitos, el monto debe ser mayor a cero y la referencia ' +
    'lleva solo letras, números y guiones.',
};
const ERROR_SIN_CONFIGURAR = { error: 'El banco simulado no está disponible en este momento.' };

export const transferirBancoRoute = createRoute({
  method: 'post',
  path: '/banco-simulado/transferencias',
  tags: ['Banco simulado'],
  summary: 'Banco simulado: hacer una transferencia',
  description:
    'Pública: es el "servidor del banco" de la pantalla `/banco` de los simuladores, no parte ' +
    'del restaurante (US-24, D70). Registra la transferencia con su id y su fecha y le avisa al ' +
    'restaurante en `POST /webhooks/banco` con el aviso firmado. No revisa que la referencia ' +
    'exista ni que el monto sea el del pedido: eso lo hace el restaurante al conciliar (US-25). ' +
    'El monto va en centavos. `avisoEntregado` dice si el restaurante respondió 2xx.',
  request: { body: { content: json(TransferenciaBancoPeticionSchema), required: true } },
  responses: {
    201: { content: json(TransferenciaBancoSchema), description: 'Transferencia hecha' },
    400: { content: json(ErrorBancoSchema), description: 'CLABE, monto o referencia inválidos' },
    503: { content: json(ErrorBancoSchema), description: 'Falta `BANCO_WEBHOOK_SECRET`' },
  },
});

export function registrarBancoSimulado(app: OpenAPIHono<AppEnv>) {
  app.openapi(
    transferirBancoRoute,
    async (c) => {
      const secreto = c.env.BANCO_WEBHOOK_SECRET;
      if (faltaSecretoBanco(secreto)) {
        console.error('Falta BANCO_WEBHOOK_SECRET: el banco simulado no puede firmar el aviso.');
        return c.json(ERROR_SIN_CONFIGURAR, 503);
      }

      const transferencia = await transferir(c.req.valid('json'), {
        secreto,
        ahora: new Date(),
        generarId: () => crypto.randomUUID(),
        // El webhook vive en esta misma app: se le entrega la petición firmada sin salir a la
        // red. Pasa por las mismas rutas y el mismo middleware que una petición de fuera.
        enviarAviso: async (cuerpo, firma) => {
          const respuesta = await app.fetch(
            new Request(new URL('/webhooks/banco', c.req.url), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', [ENCABEZADO_FIRMA_BANCO]: firma },
              body: cuerpo,
            }),
            c.env,
          );
          return respuesta.ok;
        },
      });
      return c.json(transferencia, 201);
    },
    (resultado, c) => {
      if (!resultado.success) return c.json(ERROR_TRANSFERENCIA_BANCO, 400);
    },
  );
}
