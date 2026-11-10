import { RespuestaInfoRestauranteSchema } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import type { Embedder } from '../src/services/busquedaMenu';
import { embedderQueFalla } from './embeddingsEnMemoria';
import { firmar } from './firmaDePrueba';
import { crearRepoInfoEnMemoria } from './infoEnMemoria';

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const env = { RETELL_API_KEY: LLAVE } as Bindings;

/**
 * Embedder de tres dimensiones para probar la ruta, no la calidad de la búsqueda: lo que dice
 * "estacionamiento" apunta a un lado, "wifi" a otro y todo lo demás a un tercero.
 */
const embedderEstacionamiento: Embedder = {
  async embeber(textos) {
    return textos.map((t) => {
      if (/estacionamiento/i.test(t)) return [1, 0, 0];
      return /wifi/i.test(t) ? [0, 0, 1] : [0, 1, 0];
    });
  },
};

function nuevaApp(embedder: Embedder | null = embedderEstacionamiento) {
  const repo = crearRepoInfoEnMemoria();
  const app = crearApp({ crearRepoInfo: () => repo, crearEmbedder: () => embedder });
  return { app, repo };
}

/** Cuerpo como lo manda Retell con "Payload: args only" apagado: `{ name, chat, args }`. */
const sobre = (args: unknown, name = 'info_restaurante') =>
  JSON.stringify({ name, chat: { chat_id: 'chat_123' }, args });

async function consultar(
  cuerpo: string,
  {
    aplicacion = nuevaApp().app,
    firma,
  }: { aplicacion?: ReturnType<typeof crearApp>; firma?: string | null } = {},
) {
  const encabezado = firma === undefined ? await firmar(cuerpo, LLAVE, Date.now()) : firma;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (encabezado !== null) headers['X-Retell-Signature'] = encabezado;
  return aplicacion.request(
    '/agente/info-restaurante',
    { method: 'POST', body: cuerpo, headers },
    env,
  );
}

describe('POST /agente/info-restaurante', () => {
  it('con firma válida responde 200 con la entrada que responde la pregunta', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const res = await consultar(sobre({ consulta: '¿tienen estacionamiento?' }), { aplicacion });

    expect(res.status).toBe(200);
    const { resultados } = RespuestaInfoRestauranteSchema.parse(await res.json());
    expect(resultados.map((r) => r.tema)).toEqual(['estacionamiento']);
    expect(repo.filas.size).toBe(4);
  });

  it('si nada se parece, responde 200 con la lista vacía', async () => {
    const res = await consultar(sobre({ consulta: '¿tienen wifi?' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resultados: [] });
  });

  it('rechaza con 401 sin firma o con una firma que no corresponde', async () => {
    const cuerpo = sobre({ consulta: 'horario' });

    expect((await consultar(cuerpo, { firma: null })).status).toBe(401);
    expect(
      (await consultar(cuerpo, { firma: await firmar('otro', LLAVE, Date.now()) })).status,
    ).toBe(401);
  });

  it.each([
    ['sin consulta', {}, 'args.consulta'],
    ['consulta vacía', { consulta: '   ' }, 'args.consulta'],
    ['consulta de más de 200 caracteres', { consulta: 'a'.repeat(201) }, 'args.consulta'],
    ['llave de más', { consulta: 'horario', tema: 'horario' }, 'args.tema'],
  ])('%s: 400 que nombra el campo', async (_caso, args, campo) => {
    const res = await consultar(sobre(args));

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining(campo),
    });
  });

  it('400 si la función no es info_restaurante', async () => {
    expect((await consultar(sobre({ consulta: 'horario' }, 'buscar_menu'))).status).toBe(400);
  });

  it('500 sin el binding AI o si falla Workers AI, con un mensaje sin detalles técnicos', async () => {
    for (const embedder of [null, embedderQueFalla]) {
      const res = await consultar(sobre({ consulta: 'horario' }), {
        aplicacion: nuevaApp(embedder).app,
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error:
          'No se pudo consultar la información del restaurante. Intenta de nuevo en un momento.',
      });
    }
  });

  it('aparece en /openapi.json con sus respuestas y la firma de Retell', async () => {
    const res = await nuevaApp().app.request('/openapi.json');
    const doc = (await res.json()) as {
      paths: Record<string, { post?: { responses: Record<string, unknown>; security: unknown } }>;
    };
    const ruta = doc.paths['/agente/info-restaurante']?.post;

    expect(ruta?.security).toEqual([{ FirmaRetell: [] }]);
    expect(Object.keys(ruta?.responses ?? {}).sort()).toEqual(['200', '400', '401', '500']);
  });
});
