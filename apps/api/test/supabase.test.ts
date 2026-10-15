import { describe, expect, it, vi } from 'vitest';
import { crearFetchConReintento, ESPERAS_REINTENTO_MS } from '../src/lib/supabase';

const json = (cuerpo: unknown, status: number) =>
  new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Lo que responde PostgREST cuando el JWT interno del gateway llega "del futuro" (D41). */
const jwtDelFuturo = () =>
  json({ code: 'PGRST303', message: 'JWT issued at future', details: null, hint: null }, 401);

const ok = () => json([{ id_extra: 1 }], 200);

/** `fetch` falso que responde en orden y anota lo que recibió; las esperas no tardan nada. */
function fetchCon(...respuestas: (() => Response)[]) {
  const llamadas: { entrada: unknown; init: RequestInit | undefined }[] = [];
  const fetchBase = (async (entrada: unknown, init?: RequestInit) => {
    llamadas.push({ entrada, init });
    const responder = respuestas[llamadas.length - 1];
    if (!responder) throw new Error('Llamada de más');
    return responder();
  }) as unknown as typeof fetch;
  const esperas: number[] = [];
  const esperar = (ms: number) => {
    esperas.push(ms);
    return Promise.resolve();
  };
  return { fetchConReintento: crearFetchConReintento(fetchBase, esperar), llamadas, esperas };
}

describe('crearFetchConReintento (PGRST303 "JWT issued at future", D41)', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  it('reintenta y devuelve la respuesta buena, con el mismo cuerpo y cabeceras', async () => {
    const { fetchConReintento, llamadas, esperas } = fetchCon(jwtDelFuturo, jwtDelFuturo, ok);
    const init = { method: 'POST', headers: { apikey: 'x' }, body: '{"p_id":1}' };

    const respuesta = await fetchConReintento('https://x.supabase.co/rest/v1/rpc/f', init);

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual([{ id_extra: 1 }]);
    expect(esperas).toEqual([300, 900]);
    expect(llamadas).toHaveLength(3);
    for (const llamada of llamadas) expect(llamada.init).toBe(init);
  });

  it('se rinde tras 3 reintentos y devuelve el último 401 con su cuerpo legible', async () => {
    const { fetchConReintento, llamadas, esperas } = fetchCon(
      jwtDelFuturo,
      jwtDelFuturo,
      jwtDelFuturo,
      jwtDelFuturo,
    );

    const respuesta = await fetchConReintento('https://x.supabase.co/rest/v1/extra');

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toMatchObject({ code: 'PGRST303' });
    expect(esperas).toEqual([...ESPERAS_REINTENTO_MS]);
    expect(llamadas).toHaveLength(4);
  });

  it.each([
    ['200', ok],
    ['otro 401 de PostgREST', () => json({ code: 'PGRST301', message: 'JWT expired' }, 401)],
    ['PGRST303 con otro mensaje', () => json({ code: 'PGRST303', message: 'JWT expired' }, 401)],
    ['401 que no es JSON', () => new Response('Unauthorized', { status: 401 })],
    ['500', () => json({ code: 'XX000', message: 'JWT issued at future' }, 500)],
  ])('no reintenta con %s', async (_caso, responder) => {
    const { fetchConReintento, llamadas, esperas } = fetchCon(responder);

    const respuesta = await fetchConReintento('https://x.supabase.co/rest/v1/extra');

    expect(llamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
    expect(respuesta.bodyUsed).toBe(false);
  });

  it('un error de red se propaga sin reintentar', async () => {
    const { fetchConReintento, llamadas } = fetchCon(() => {
      throw new TypeError('fetch failed');
    });

    await expect(fetchConReintento('https://x.supabase.co/rest/v1/extra')).rejects.toThrow(
      'fetch failed',
    );
    expect(llamadas).toHaveLength(1);
  });
});
