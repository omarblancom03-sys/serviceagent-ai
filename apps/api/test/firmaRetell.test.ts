import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv, Bindings } from '../src/lib/env';
import { requiereFirmaRetell, verificarFirmaRetell } from '../src/lib/firmaRetell';
import { firmar } from './firmaDePrueba';

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const AHORA = 1_790_000_000_000;
const CUERPO = JSON.stringify({ name: 'cotizar_pedido', call: {}, args: { productos: [] } });

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

  /*
   * Vector fijo: el digesto se calculó UNA vez fuera del test con node:crypto y se pegó aquí, sin
   * pasar por `firmar()`. Si `firmar()` y el código tuvieran el mismo error, este test lo detecta.
   *   createHmac('sha256', 'llave_falsa_vector_fijo')
   *     .update(cuerpo + '1790000000000', 'utf8').digest('hex')
   * El cuerpo lleva acentos y ñ para comprobar que se firma en UTF-8.
   */
  it('acepta un vector fijo calculado con node:crypto (cuerpo con acentos)', async () => {
    const cuerpo =
      '{"name":"cotizar_pedido","args":{"productos":[{"nombre":"Papa con Champiñón","cantidad":1}]}}';
    const encabezado =
      'v=1790000000000,d=031d4a042156d1c0390b857db44fbdf63792eeecbb06a107018f8e925857165a';
    expect(
      await verificarFirmaRetell(cuerpo, encabezado, 'llave_falsa_vector_fijo', 1_790_000_000_000),
    ).toBe(true);
  });

  it('acepta una firma de hace casi 5 minutos', async () => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA - 4 * 60 * 1000);
    expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(true);
  });

  it.each([
    ['de hace 5 minutos exactos', -1],
    ['de dentro de 5 minutos exactos', 1],
  ])('acepta una firma %s (el límite cuenta como vigente)', async (_caso, signo) => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA + signo * 5 * 60 * 1000);
    expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(true);
  });

  it('rechaza una firma de 5 minutos y 1 milisegundo', async () => {
    const encabezado = await firmar(CUERPO, LLAVE, AHORA - 5 * 60 * 1000 - 1);
    expect(await verificarFirmaRetell(CUERPO, encabezado, LLAVE, AHORA)).toBe(false);
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

  it.each([
    ['vacía', ''],
    ['de un espacio', ' '],
  ])('responde 500 si RETELL_API_KEY está %s', async (_caso, llave) => {
    const res = await pedir(
      { 'X-Retell-Signature': await firmar(CUERPO, LLAVE, Date.now()) },
      { ...env, RETELL_API_KEY: llave },
    );
    expect(res.status).toBe(500);
  });
});
