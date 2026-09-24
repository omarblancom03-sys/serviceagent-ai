import { z } from 'zod';

/**
 * Respuesta de `GET /health`.
 * Vive en `shared` para comprobar que la API y los frontends comparten el mismo esquema.
 */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().min(1),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
