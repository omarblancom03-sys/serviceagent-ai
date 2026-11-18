import { z } from 'zod';

/**
 * Validación del token de Cloudflare Turnstile con siteverify, con `fetch` directo (D68, D77).
 * Referencia: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 * El token y la llave secreta nunca se registran en logs; la IP se manda y no se guarda.
 */

export const URL_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Milisegundos máximos para siteverify; los ejemplos de Cloudflare usan 10 s. */
export const TIMEOUT_TURNSTILE_MS = 10_000;

/**
 * - `valido`: Cloudflare aceptó el token.
 * - `token_rechazado`: el token falta, no es válido, venció o ya se usó; uno nuevo puede pasar.
 * - `no_disponible`: falla de nuestro lado o de Cloudflare (llave mala, 5xx, sin conexión,
 *   timeout o respuesta ilegible); un token nuevo no lo arregla.
 */
export type ResultadoTurnstile = 'valido' | 'token_rechazado' | 'no_disponible';

export interface VerificadorTurnstile {
  verificar(token: string, ip: string | null): Promise<ResultadoTurnstile>;
}

/** Errores de siteverify que dependen del token, no de la llave ni de Cloudflare. */
const ERRORES_DEL_TOKEN = new Set([
  'missing-input-response',
  'invalid-input-response',
  'timeout-or-duplicate',
]);

/** Los demás errores documentados; uno desconocido se anota como `otro`. */
const ERRORES_CONOCIDOS = new Set([
  ...ERRORES_DEL_TOKEN,
  'missing-input-secret',
  'invalid-input-secret',
  'bad-request',
  'internal-error',
]);

const RespuestaSiteverifySchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.unknown()).optional(),
});

export interface OpcionesTurnstile {
  /** Para los tests: un `fetch` falso. Por defecto, el del Worker. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function crearVerificadorTurnstile(
  secreto: string,
  opciones: OpcionesTurnstile = {},
): VerificadorTurnstile {
  const hacerFetch = opciones.fetch ?? ((url, init) => fetch(url, init));
  const timeoutMs = opciones.timeoutMs ?? TIMEOUT_TURNSTILE_MS;

  return {
    async verificar(token, ip) {
      const control = new AbortController();
      const temporizador = setTimeout(() => control.abort(), timeoutMs);
      try {
        let res: Response;
        try {
          res = await hacerFetch(URL_SITEVERIFY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret: secreto,
              response: token,
              ...(ip ? { remoteip: ip } : {}),
            }),
            signal: control.signal,
          });
        } catch {
          return noDisponible(control.signal.aborted ? 'timeout' : 'sin_conexion');
        }
        if (!res.ok) return noDisponible('estado', res.status);

        let cuerpo: unknown;
        try {
          cuerpo = await res.json();
        } catch {
          return noDisponible(control.signal.aborted ? 'timeout' : 'ilegible');
        }
        const leido = RespuestaSiteverifySchema.safeParse(cuerpo);
        if (!leido.success) return noDisponible('ilegible');
        if (leido.data.success) return 'valido';

        const errores = (leido.data['error-codes'] ?? []).map((e) =>
          typeof e === 'string' && ERRORES_CONOCIDOS.has(e) ? e : 'otro',
        );
        const delToken = errores.length > 0 && errores.every((e) => ERRORES_DEL_TOKEN.has(e));
        console.warn('chat: Turnstile rechazó la verificación', { errores });
        return delToken ? 'token_rechazado' : 'no_disponible';
      } finally {
        clearTimeout(temporizador);
      }
    },
  };
}

function noDisponible(falla: string, status?: number): ResultadoTurnstile {
  console.warn('chat: siteverify no respondió', { falla, status: status ?? null });
  return 'no_disponible';
}
