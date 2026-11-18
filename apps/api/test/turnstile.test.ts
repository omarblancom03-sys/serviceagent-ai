import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearVerificadorTurnstile, URL_SITEVERIFY } from '../src/lib/turnstile';

const SECRETO = 'SECRETO_TURNSTILE_NO_DEBE_SALIR';
const TOKEN = 'TOKEN_TURNSTILE_NO_DEBE_SALIR';

/** Verificador con un `fetch` falso: nunca sale a la red. Anota lo que se habría mandado. */
function verificadorCon(responder: (init: RequestInit) => Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const fetchFalso = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init });
    return responder(init);
  }) as unknown as typeof fetch;
  const verificador = crearVerificadorTurnstile(SECRETO, { fetch: fetchFalso, timeoutMs: 20 });
  return { verificador, llamadas };
}

const json = (cuerpo: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(cuerpo), { status }));

/** Imita a un servidor que nunca responde: solo termina cuando se aborta la petición. */
const nuncaResponde = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    );
  });

let escritos: unknown[][] = [];
beforeEach(() => {
  escritos = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    escritos.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  const logs = JSON.stringify(escritos);
  expect(logs).not.toContain(SECRETO);
  expect(logs).not.toContain(TOKEN);
  expect(logs).not.toContain('203.0.113.7');
});

describe('Turnstile: petición a siteverify', () => {
  it('manda la llave, el token y la IP por POST en JSON', async () => {
    const { verificador, llamadas } = verificadorCon(() => json({ success: true }));

    expect(await verificador.verificar(TOKEN, '203.0.113.7')).toBe('valido');

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.url).toBe(URL_SITEVERIFY);
    expect(llamadas[0]?.init.method).toBe('POST');
    expect(llamadas[0]?.init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({
      secret: SECRETO,
      response: TOKEN,
      remoteip: '203.0.113.7',
    });
  });

  it('sin IP no manda remoteip', async () => {
    const { verificador, llamadas } = verificadorCon(() => json({ success: true }));

    await verificador.verificar(TOKEN, null);

    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({
      secret: SECRETO,
      response: TOKEN,
    });
  });
});

describe('Turnstile: token rechazado (uno nuevo puede pasar)', () => {
  it.each([
    [['invalid-input-response']],
    [['timeout-or-duplicate']],
    [['missing-input-response']],
    [['invalid-input-response', 'timeout-or-duplicate']],
  ])('success false con %j', async (errores) => {
    const { verificador } = verificadorCon(() => json({ success: false, 'error-codes': errores }));

    expect(await verificador.verificar(TOKEN, null)).toBe('token_rechazado');
    expect(JSON.stringify(escritos)).toContain(errores[0]);
  });
});

describe('Turnstile: no disponible (un token nuevo no lo arregla)', () => {
  it.each([
    ['la llave no es válida', { success: false, 'error-codes': ['invalid-input-secret'] }],
    ['falta la llave', { success: false, 'error-codes': ['missing-input-secret'] }],
    ['error interno', { success: false, 'error-codes': ['internal-error'] }],
    ['petición mal formada', { success: false, 'error-codes': ['bad-request'] }],
    ['un error desconocido', { success: false, 'error-codes': ['algo-nuevo'] }],
    [
      'token y llave a la vez',
      { success: false, 'error-codes': ['invalid-input-response', 'invalid-input-secret'] },
    ],
    ['success false sin errores', { success: false }],
    ['una respuesta sin success', { ok: true }],
  ])('%s', async (_, cuerpo) => {
    const { verificador } = verificadorCon(() => json(cuerpo));

    expect(await verificador.verificar(TOKEN, null)).toBe('no_disponible');
  });

  it('anota un error desconocido como "otro", sin copiar lo que mandó Cloudflare', async () => {
    const { verificador } = verificadorCon(() =>
      json({ success: false, 'error-codes': [`${TOKEN}-inyectado`] }),
    );

    expect(await verificador.verificar(TOKEN, null)).toBe('no_disponible');
    expect(JSON.stringify(escritos)).toContain('otro');
  });

  it.each([500, 502, 429, 400])('responde %i', async (status) => {
    const { verificador } = verificadorCon(() => json({ success: true }, status));

    expect(await verificador.verificar(TOKEN, null)).toBe('no_disponible');
    expect(JSON.stringify(escritos)).toContain(`"status":${status}`);
  });

  it('400 con invalid-input-secret: registra el estado y el código', async () => {
    const { verificador } = verificadorCon(() =>
      json({ success: false, 'error-codes': ['invalid-input-secret'] }, 400),
    );

    expect(await verificador.verificar(TOKEN, '203.0.113.7')).toBe('no_disponible');
    const logs = JSON.stringify(escritos);
    expect(logs).toContain('"status":400');
    expect(logs).toContain('invalid-input-secret');
    expect(logs).not.toContain('siteverify no respondió');
  });

  it('400 con un cuerpo que no es JSON: registra solo el estado', async () => {
    const { verificador } = verificadorCon(() =>
      Promise.resolve(new Response('<html>', { status: 400 })),
    );

    expect(await verificador.verificar(TOKEN, '203.0.113.7')).toBe('no_disponible');
    const logs = JSON.stringify(escritos);
    expect(logs).toContain('"status":400');
    expect(logs).toContain('siteverify no respondió');
    expect(logs).not.toContain('errores');
  });

  it('500 con JSON sin error-codes: registra solo el estado', async () => {
    const { verificador } = verificadorCon(() => json({ success: false }, 500));

    expect(await verificador.verificar(TOKEN, '203.0.113.7')).toBe('no_disponible');
    const logs = JSON.stringify(escritos);
    expect(logs).toContain('"status":500');
    expect(logs).not.toContain('errores');
  });

  it('400 con un código desconocido: lo anota como "otro", sin copiarlo', async () => {
    const { verificador } = verificadorCon(() =>
      json({ success: false, 'error-codes': [`${TOKEN}-inyectado`] }, 400),
    );

    expect(await verificador.verificar(TOKEN, '203.0.113.7')).toBe('no_disponible');
    expect(JSON.stringify(escritos)).toContain('otro');
  });

  it('un cuerpo que no es JSON', async () => {
    const { verificador } = verificadorCon(() => Promise.resolve(new Response('<html>')));

    expect(await verificador.verificar(TOKEN, null)).toBe('no_disponible');
  });

  it('sin conexión', async () => {
    const { verificador } = verificadorCon(() => Promise.reject(new TypeError('fetch failed')));

    expect(await verificador.verificar(TOKEN, null)).toBe('no_disponible');
    expect(JSON.stringify(escritos)).toContain('sin_conexion');
  });

  it('timeout: no espera para siempre', async () => {
    const { verificador } = verificadorCon(nuncaResponde);

    expect(await verificador.verificar(TOKEN, null)).toBe('no_disponible');
    expect(JSON.stringify(escritos)).toContain('timeout');
  });
});
