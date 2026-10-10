import { createMiddleware } from 'hono/factory';
import type { AppEnv } from './env';
import { igualesEnTiempoConstante } from './pin';

/**
 * Verificación de `X-Retell-Signature` (docs/agente.md → toda petición de Retell se verifica).
 * Formato según la documentación de Retell (features/secure-webhook):
 * - Header: `v=<timestamp en ms>,d=<HMAC-SHA256 en hex>`.
 * - `d = HMAC-SHA256(cuerpoCrudo + timestamp, RETELL_API_KEY)`, con la API key que tiene badge de
 *   webhook. El cuerpo debe ser el texto CRUDO: volver a serializar el JSON cambia la firma.
 * - Se rechaza si el timestamp difiere más de 5 minutos de la hora actual, en cualquier dirección.
 * Con Web Crypto, sin `retell-sdk`.
 */

const TOLERANCIA_MS = 5 * 60 * 1000;
const FORMATO_ENCABEZADO = /^v=(\d+),d=([0-9a-f]{64})$/i;

/** `true` solo si el encabezado es una firma válida y vigente de `cuerpo` con `llave`. */
export async function verificarFirmaRetell(
  cuerpo: string,
  encabezado: string | undefined,
  llave: string,
  ahoraMs: number = Date.now(),
): Promise<boolean> {
  const coincidencia = FORMATO_ENCABEZADO.exec(encabezado?.trim() ?? '');
  const timestamp = coincidencia?.[1];
  const digestoHex = coincidencia?.[2];
  if (!timestamp || !digestoHex) return false;
  if (Math.abs(ahoraMs - Number(timestamp)) > TOLERANCIA_MS) return false;

  const codificador = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(llave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const esperado = await crypto.subtle.sign('HMAC', clave, codificador.encode(cuerpo + timestamp));
  return igualesEnTiempoConstante(new Uint8Array(esperado), deHex(digestoHex));
}

/**
 * Protege una ruta que llama Retell. Corre ANTES de validar el cuerpo con zod (en `createRoute`
 * el middleware va antes que los validadores), así que una petición sin firma válida recibe 401
 * aunque el cuerpo esté mal formado. Hono guarda el cuerpo en caché: el validador lee el mismo
 * texto que se firmó.
 */
export function requiereFirmaRetell() {
  return createMiddleware<AppEnv>(async (c, next) => {
    const llave = c.env.RETELL_API_KEY;
    // Una llave en blanco cuenta como faltante. No se exige un largo mínimo (decisión del PO): la
    // llave la carga solo el PO desde el dashboard de Retell.
    if (!llave || llave.trim() === '') {
      console.error('Falta RETELL_API_KEY: no se puede verificar la firma de Retell.');
      return c.json({ error: 'El servicio no está configurado. Intenta más tarde.' }, 500);
    }

    const cuerpo = await c.req.text();
    if (!(await verificarFirmaRetell(cuerpo, c.req.header('X-Retell-Signature'), llave))) {
      return c.json({ error: 'Firma de Retell inválida.' }, 401);
    }
    await next();
  });
}

/** El formato del encabezado ya garantiza 64 caracteres hexadecimales. */
function deHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
