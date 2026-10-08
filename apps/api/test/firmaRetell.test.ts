import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv, Bindings } from '../src/lib/env';
import { requiereFirmaRetell, verificarFirmaRetell } from '../src/lib/firmaRetell';

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const AHORA = 1_790_000_000_000;
const CUERPO = JSON.stringify({ name: 'cotizar_pedido', call: {}, args: { productos: [] } });

/** Firma igual que Retell: HMAC-SHA256(cuerpo + timestamp, llave) en hex. */
async function firmar(cuerpo: string, llave: string, timestamp: number): Promise<string> {
  const codificador = new TextEncoder();
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(llave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(cuerpo + timestamp));
  const hex = [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v=${timestamp},d=${hex}`;
}

describe('verificarFirmaRetell', () => {
  it('acepta una firma válida y vigente', async () => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA);
    expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(true);
  });

  it('acepta el digesto en mayúsculas', async () => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA);
    const [v, d] = encabezado.split(',');
    expect(await verificarFirmaRetell(CUERPO, `${v},${d?.toUpperCase()}`, LLAVE, AHORA)).toBe(true);
  });

  it('acepta una firma de hace casi 5 minutos', async () => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA - 4 * 60 * 1000);
    expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(true);
  });

  it('rechaza si falta el encabezado o está mal formado', async () => {
    const valido = await firmar(CUERPO, LLAVE, AHORA);
    for (const encabezado of [
      undefined,
      '',
      'firma-cualquiera',
      valido.replace('v=', 't='),
      `v=${AHORA},d=abc123`,
      `v=${AHORA}`,
    ]) {
      expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(false);
    }
  });

  it('rechaza un digesto alterado', async () => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA);
    const ultimo = encabezado.at(-1) === '0' ? '1' : '0';
    expect(await verificarFirmaRetell(CUERPO, encabezado.slice(0, -1) + ultimo, LLAVE, AHORA)).toBe(
      false,
    );
  });

  it('rechaza si el cuerpo cambió después de firmar (incluso solo espacios)', async () => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA);
    const reserializado = JSON.stringify(JSON.parse(CUERPO), null, 2);
    expect(await verificarFirmaRetell(reserializado, encabezado, LLAVE, AHORA)).toBe(false);
  });

  it('rechaza una firma hecha con otra llave', async () => {
    const encabezado = await firmar(CUERPO, 'llave-falsa-de-prueba', AHORA);
    expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(false);
  });

  it.each([
    ['vencida (hace 6 min)', -6],
    ['del futuro (en 6 min)', 6],
  ])('rechaza una firma %s', async (_caso, minutos) => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA + minutos * 60 * 1000);
    expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(false);
  });
});

describe('requiereFirmaRetell (middleware)', () => {
  // Ruta mínima: si la firma pasa, devuelve el cuerpo ya parseado (comprueba que se puede leer
  // otra vez después del middleware, como hará el validador de zod).
  const app = new Hono<AppEnv>().post('/prueba', requiereFirmaRetell(), async (c) =>
    c.json(await c.req.json()),
  );
  const env = { RETELL_API_KEY: LLAVE } as Bindings;

  const pedir = (encabezados: Record<string, string>, entorno: Bindings = env) =>
    app.request(
      '/prueba',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...encabezados },
        body: CUERPO,
      },
      entorno,
    );

  it('deja pasar una petición firmada y el cuerpo se puede volver a leer', async () => {
    const res = await pedir({ 'X-Retell-Signature': await firmar(CUERPO, LLAVE, Date.now()) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(CUERPO));
  });

  it('responde 401 { error } sin firma o con firma inválida', async () => {
    const casos: Record<string, string>[] = [
      {},
      { 'X-Retell-Signature': await firmar(CUERPO, 'llave-falsa-de-prueba', Date.now()) },
    ];
    for (const encabezados of casos) {
      const res = await pedir(encabezados);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Firma de Retell inválida.' });
    }
  });

  it('responde 500 si falta RETELL_API_KEY', async () => {
    const res = await pedir(
      { 'X-Retell-Signature': await firmar(CUERPO, LLAVE, Date.now()) },
      { ...env, RETELL_API_KEY: '' },
    );
    expect(res.status).toBe(500);
  });
});
