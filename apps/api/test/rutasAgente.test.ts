import { RespuestaBuscarMenuSchema } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import type { Embedder } from '../src/services/busquedaMenu';
import { crearRepoEmbeddingsEnMemoria, embedderQueFalla } from './embeddingsEnMemoria';
import { firmar } from './firmaDePrueba';
import { crearRepoMenuEnMemoria } from './menuEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

const seed = leerSeedMenu();
const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const env = { RETELL_API_KEY: LLAVE } as Bindings;

/**
 * Embedder de tres dimensiones para probar la ruta, no la calidad de la búsqueda: lo que dice
 * "hawaiana" apunta a un lado, "sushi" a otro y todo lo demás a un tercero. Así "hamburguesa
 * hawaiana" encuentra solo la Hamburguesa Hawaiana (similitud 1) y "sushi" no se parece a nada.
 */
const embedderHawaiana: Embedder = {
  async embeber(textos) {
    return textos.map((t) => {
      if (/hawaiana/i.test(t)) return [1, 0, 0];
      return /sushi/i.test(t) ? [0, 0, 1] : [0, 1, 0];
    });
  },
};

function nuevaApp(embedder: Embedder | null = embedderHawaiana) {
  const repo = crearRepoEmbeddingsEnMemoria();
  const app = crearApp({
    crearRepoMenu: () => crearRepoMenuEnMemoria(seed.filas, seed.sinonimos),
    crearRepoEmbeddings: () => repo,
    crearEmbedder: () => embedder,
  });
  return { app, repo };
}

/** Cuerpo como lo manda Retell a un agente de chat con "Payload: args only" apagado: `{ name, chat, args }`. */
const sobre = (args: unknown, name = 'buscar_menu') =>
  JSON.stringify({ name, chat: { chat_id: 'chat_123' }, args });

async function buscar(
  cuerpo: string,
  {
    aplicacion = nuevaApp().app,
    firma,
  }: { aplicacion?: ReturnType<typeof crearApp>; firma?: string | null } = {},
) {
  const encabezado = firma === undefined ? await firmar(cuerpo, LLAVE, Date.now()) : firma;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (encabezado !== null) headers['X-Retell-Signature'] = encabezado;
  return aplicacion.request('/agente/buscar-menu', { method: 'POST', body: cuerpo, headers }, env);
}

describe('POST /agente/buscar-menu', () => {
  it('con firma válida responde 200 con los platillos encontrados y sus precios', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const res = await buscar(sobre({ consulta: 'hamburguesa hawaiana' }), { aplicacion });

    expect(res.status).toBe(200);
    const { resultados } = RespuestaBuscarMenuSchema.parse(await res.json());
    expect(resultados.map((r) => r.nombre)).toEqual(['Hamburguesa Hawaiana']);
    expect(resultados[0]?.precios[0]?.precioTexto).toMatch(/^\$\d/);
    expect(repo.filas.size).toBe(95);
  });

  it('si nada se parece, responde 200 con la lista vacía', async () => {
    const res = await buscar(sobre({ consulta: 'sushi' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resultados: [] });
  });

  it('rechaza con 401 sin firma o con una firma que no corresponde', async () => {
    const cuerpo = sobre({ consulta: 'tacos' });

    expect((await buscar(cuerpo, { firma: null })).status).toBe(401);
    expect((await buscar(cuerpo, { firma: await firmar('otro', LLAVE, Date.now()) })).status).toBe(
      401,
    );
  });

  it.each([
    ['sin consulta', {}, 'args.consulta'],
    ['consulta vacía', { consulta: '   ' }, 'args.consulta'],
    ['consulta de más de 200 caracteres', { consulta: 'a'.repeat(201) }, 'args.consulta'],
    ['llave de más', { consulta: 'tacos', limite: 10 }, 'args.limite'],
  ])('%s: 400 que nombra el campo', async (_caso, args, campo) => {
    const res = await buscar(sobre(args));

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining(campo),
    });
  });

  it('una consulta de exactamente 200 caracteres sí se acepta (el límite es 200)', async () => {
    const res = await buscar(sobre({ consulta: 'a'.repeat(200) }));

    expect(res.status).toBe(200);
    expect(RespuestaBuscarMenuSchema.safeParse(await res.json()).success).toBe(true);
  });

  it('400 si la función no es buscar_menu', async () => {
    expect((await buscar(sobre({ consulta: 'tacos' }, 'cotizar_pedido'))).status).toBe(400);
  });

  it('500 sin el binding AI o si falla Workers AI, con un mensaje sin detalles técnicos', async () => {
    for (const embedder of [null, embedderQueFalla]) {
      const res = await buscar(sobre({ consulta: 'tacos' }), {
        aplicacion: nuevaApp(embedder).app,
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'No se pudo buscar en el menú. Intenta de nuevo en un momento.',
      });
    }
  });

  it('aparece en /openapi.json con sus respuestas y la firma de Retell', async () => {
    const res = await nuevaApp().app.request('/openapi.json');
    const doc = (await res.json()) as {
      paths: Record<string, { post?: { responses: Record<string, unknown>; security: unknown } }>;
    };
    const ruta = doc.paths['/agente/buscar-menu']?.post;

    expect(ruta?.security).toEqual([{ FirmaRetell: [] }]);
    expect(Object.keys(ruta?.responses ?? {}).sort()).toEqual(['200', '400', '401', '500']);
  });
});
