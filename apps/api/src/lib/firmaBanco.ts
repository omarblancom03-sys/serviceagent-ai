import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './env';
import { igualesEnTiempoConstante } from './pin';

/**
 * Firma del aviso del banco (US-24, D70; docs/negocio.md → Pagos). Formato propio de la simulación,
 * con la misma idea que la firma de Retell (`firmaRetell.ts`):
 * - Encabezado `X-Banco-Firma`: `t=<timestamp en ms>,v1=<HMAC-SHA256 en hex>`.
 * - `v1 = HMAC-SHA256("<timestamp>.<cuerpoCrudo>", BANCO_WEBHOOK_SECRET)`. Se firma el texto CRUDO
 *   del cuerpo: volver a serializar el JSON cambia la firma.
 * - Se rechaza si el timestamp difiere más de 5 minutos de la hora actual, en cualquier dirección.
 */

export const ENCABEZADO_FIRMA_BANCO = 'X-Banco-Firma';

const TOLERANCIA_MS = 5 * 60 * 1000;
const FORMATO_ENCABEZADO = /^t=(\d{1,16}),v1=([0-9a-f]{64})$/i;

async function hmac(secreto: string, texto: string): Promise<Uint8Array> {
  const codificador = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', clave, codificador.encode(texto)));
}

const aHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** El formato del encabezado ya garantiza 64 caracteres hexadecimales. */
function deHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** `true` si el secreto falta o está en blanco: sin él no se firma ni se verifica nada. */
export const faltaSecretoBanco = (secreto: string | undefined): secreto is undefined =>
  !secreto || secreto.trim() === '';

/** Valor de `X-Banco-Firma` para `cuerpo`. Lo usa el lado del banco (`services/bancoSimulado.ts`). */
export async function firmarAvisoBanco(
  cuerpo: string,
  secreto: string,
  ahoraMs: number = Date.now(),
): Promise<string> {
  return `t=${ahoraMs},v1=${aHex(await hmac(secreto, `${ahoraMs}.${cuerpo}`))}`;
}

/** `true` solo si el encabezado es una firma válida y vigente de `cuerpo` con `secreto`. */
export async function verificarFirmaBanco(
  cuerpo: string,
  encabezado: string | undefined,
  secreto: string,
  ahoraMs: number = Date.now(),
): Promise<boolean> {
  const coincidencia = FORMATO_ENCABEZADO.exec(encabezado?.trim() ?? '');
  const timestamp = coincidencia?.[1];
  const digestoHex = coincidencia?.[2];
  if (!timestamp || !digestoHex) return false;
  if (Math.abs(ahoraMs - Number(timestamp)) > TOLERANCIA_MS) return false;

  const esperado = await hmac(secreto, `${timestamp}.${cuerpo}`);
  return igualesEnTiempoConstante(esperado, deHex(digestoHex));
}

/**
 * Protege el webhook del banco. Corre ANTES de validar el cuerpo con zod, así que un aviso sin
 * firma válida recibe 401 aunque el cuerpo esté mal formado. Hono guarda el cuerpo en caché: el
 * validador lee el mismo texto que se firmó.
 */
export function requiereFirmaBanco() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const secreto = c.env.BANCO_WEBHOOK_SECRET;
    if (faltaSecretoBanco(secreto)) {
      console.error('Falta BANCO_WEBHOOK_SECRET: no se puede verificar la firma del banco.');
      return c.json({ error: 'El servicio no está configurado. Intenta más tarde.' }, 500);
    }

    const cuerpo = await c.req.text();
    if (!(await verificarFirmaBanco(cuerpo, c.req.header(ENCABEZADO_FIRMA_BANCO), secreto))) {
      return c.json({ error: 'Firma del banco inválida.' }, 401);
    }
    await next();
  });
}
