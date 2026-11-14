import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CotizarPedidoArgsSchema,
  RespuestaCotizarPedidoSchema,
  type Aclaracion,
  type RespuestaCotizarPedido,
} from '@serviceagent/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import { normalizarSinRelleno } from '../src/lib/normalizar';
import {
  buscarEnMenu,
  buscarParecidos,
  type Embedder,
  type EmbeddingsRepo,
  type PlatilloSimilar,
} from '../src/services/busquedaMenu';
import {
  armarCatalogo,
  cotizarPedido,
  obtenerCotizacion,
  resolverPlatillo,
  type BuscarParecidos,
} from '../src/services/cotizacion';
import { armarMenu, type Sugerencia } from '../src/services/menu';
import {
  crearEmbedderDePrueba,
  crearRepoEmbeddingsEnMemoria,
  embedderQueFalla,
} from './embeddingsEnMemoria';
import { firmar } from './firmaDePrueba';
import { crearRepoMenuEnMemoria } from './menuEnMemoria';
import { leerSeedMenu, leerSeedSugerencias } from './seedEnMemoria';

/* US-15-P1 (D72): `sugerida` en un `ambiguo` y `parecido` en un `no_existe` de cotizar. */

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = leerSeedMenu();
const sugerencias = leerSeedSugerencias(seed.filas);
const menu = armarMenu(seed.filas);
const catalogo = armarCatalogo(menu, seed.sinonimos, sugerencias);
const idDe = (nombre: string) => {
  const platillo = seed.filas.platillos.find((p) => p.nombre === nombre);
  if (!platillo) throw new Error(`No está en el seed: ${nombre}`);
  return platillo.id;
};
const args = (...productos: string[]) =>
  CotizarPedidoArgsSchema.parse({
    productos: productos.map((producto) => ({ producto, cantidad: 1 })),
  });
const aclaraciones = (respuesta: RespuestaCotizarPedido): Aclaracion[] =>
  respuesta.ok ? [] : respuesta.aclaraciones;

/** La lista que aprobó el PO el 2026-11-14. */
const LISTA_DEL_PO: [string, string][] = [
  ['hamburguesa', 'Hamburguesa Granero'],
  ['papas', 'Papas francesas'],
  ['tacos', 'Tacos de Arrachera'],
  ['taquiza', 'Taquiza Granero'],
  ['fajitas', 'Fajitas de arrachera'],
  ['filete', 'Filete de pescado empanizado'],
  ['caldo', 'Caldo de camarón'],
  ['ensalada', 'Ensalada Granero'],
  ['costillas', 'Costillas BBQ 450 gr'],
  ['camarones', 'Camarones al Ajillo'],
  ['parrillada', 'Parrillada Familiar'],
  ['cerveza', 'Cerveza nacional 355 ml'],
  ['pizerola', 'Pizerola de Sirloin'],
  ['limonada', 'Limonada natural'],
];

describe('seed 06_sugerencias_ambiguo.sql', () => {
  const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const leer = (archivo: string) => readFileSync(path.join(raizRepo, archivo), 'utf-8');

  it('trae exactamente la lista del PO', () => {
    const nombreDe = new Map(seed.filas.platillos.map((p) => [p.id, p.nombre]));
    expect(sugerencias.map((s) => [s.frase, nombreDe.get(s.idPlatillo)])).toEqual(LISTA_DEL_PO);
  });

  it('ninguna frase choca con otra al normalizarla', () => {
    const llaves = sugerencias.map((s) => normalizarSinRelleno(s.frase));
    expect(new Set(llaves).size).toBe(llaves.length);
  });

  it.each(LISTA_DEL_PO)(
    '"%s" da ambiguo y sugiere %s, que está entre las opciones',
    (frase, nombre) => {
      const resultado = resolverPlatillo(catalogo, frase);
      expect(resultado).toMatchObject({ tipo: 'ambiguo', sugerida: nombre });
      expect(resultado.tipo === 'ambiguo' && resultado.opciones).toContain(nombre);
    },
  );

  it('se puede correr varias veces, borra las frases retiradas y va después del menú', () => {
    const sql = leer('supabase/seed/06_sugerencias_ambiguo.sql');
    expect(sql).toContain('on conflict (frase) do update');
    expect(sql).toContain('retirados as (');
    const config = leer('supabase/config.toml');
    const posicion = (archivo: string) => config.indexOf(`./seed/${archivo}`);
    expect(posicion('06_sugerencias_ambiguo.sql')).toBeGreaterThan(
      posicion('01_menu_el_granero.sql'),
    );
    expect(posicion('06_sugerencias_ambiguo.sql')).toBeGreaterThan(-1);
  });
});

describe('sugerida en un ambiguo (criterio 1)', () => {
  it.each([
    ['una hamburguesa', 'Hamburguesa Granero'],
    ['hamburguesas', 'Hamburguesa Granero'],
    ['unas papas para llevar', 'Papas francesas'],
    ['papa', 'Papas francesas'],
    ['orden de tacos', 'Tacos de Arrachera'],
    ['un taco', 'Tacos de Arrachera'],
    ['camarón', 'Camarones al Ajillo'],
    ['CERVEZAS', 'Cerveza nacional 355 ml'],
  ])('"%s" sugiere %s: la frase se compara normalizada', (dicho, nombre) => {
    expect(resolverPlatillo(catalogo, dicho)).toMatchObject({ tipo: 'ambiguo', sugerida: nombre });
  });

  it.each(['pollo', 'granero', 'queso', 'natural', 'delicias'])(
    '"%s" sigue ambiguo y sin sugerencia: no está en la lista',
    (dicho) => {
      const resultado = resolverPlatillo(catalogo, dicho);
      expect(resultado.tipo).toBe('ambiguo');
      expect(resultado).not.toHaveProperty('sugerida');
    },
  );

  it('solo sugiere si lo dicho es exactamente la frase: "hamburguesa algo" no', () => {
    // "hamburguesa granero" es el nombre exacto: se encuentra sin preguntar.
    expect(resolverPlatillo(catalogo, 'hamburguesa granero').tipo).toBe('encontrado');
    // "hamburguesa tocino" se pregunta (un solo platillo la contiene), pero no es la frase "hamburguesa".
    const tocino = resolverPlatillo(catalogo, 'hamburguesa tocino');
    expect(tocino.tipo).toBe('ambiguo');
    expect(tocino).not.toHaveProperty('sugerida');
  });

  it('nunca sugiere un platillo que no está entre las opciones', () => {
    const otro: Sugerencia[] = [
      { frase: 'pollo', idPlatillo: idDe('Tacos de Arrachera'), activo: true },
    ];
    const resultado = resolverPlatillo(armarCatalogo(menu, seed.sinonimos, otro), 'pollo');
    expect(resultado.tipo).toBe('ambiguo');
    expect(resultado).not.toHaveProperty('sugerida');
  });

  it('ignora las sugerencias inactivas o de platillos que no se ven en el menú', () => {
    const inactiva = sugerencias.map((s) => ({ ...s, activo: s.frase !== 'hamburguesa' }));
    expect(
      resolverPlatillo(armarCatalogo(menu, seed.sinonimos, inactiva), 'hamburguesa'),
    ).not.toHaveProperty('sugerida');

    const filas = structuredClone(seed.filas);
    const granero = filas.platillos.find((p) => p.nombre === 'Hamburguesa Granero');
    if (granero) granero.activo = false;
    const sinGranero = armarCatalogo(armarMenu(filas), seed.sinonimos, sugerencias);
    expect(resolverPlatillo(sinGranero, 'hamburguesa')).not.toHaveProperty('sugerida');
  });

  it('si dos frases quedan con la misma llave, vale la primera', () => {
    const repetidas: Sugerencia[] = [
      { frase: 'papas', idPlatillo: idDe('Papas francesas'), activo: true },
      { frase: 'Papa', idPlatillo: idDe('Papa Natural'), activo: true },
    ];
    expect(resolverPlatillo(armarCatalogo(menu, seed.sinonimos, repetidas), 'papa')).toMatchObject({
      sugerida: 'Papas francesas',
    });
  });

  it('cotizar la manda en la aclaración, junto a las opciones', () => {
    const respuesta = RespuestaCotizarPedidoSchema.parse(
      cotizarPedido(catalogo, args('una hamburguesa')),
    );
    expect(aclaraciones(respuesta)).toEqual([
      expect.objectContaining({
        tipo: 'ambiguo',
        producto: 'una hamburguesa',
        sugerida: 'Hamburguesa Granero',
        opciones: expect.arrayContaining(['Hamburguesa Granero', 'Hamburguesa Hawaiana']),
      }),
    ]);
  });

  it('obtenerCotizacion lee las sugerencias del repo (también la usa crear_pedido)', async () => {
    const repo = crearRepoMenuEnMemoria(seed.filas, seed.sinonimos, sugerencias);
    const respuesta = await obtenerCotizacion(repo, args('tacos'));
    expect(aclaraciones(respuesta)[0]).toMatchObject({ sugerida: 'Tacos de Arrachera' });
  });
});

describe('parecido en un no_existe (criterio 2)', () => {
  const repo = () => crearRepoMenuEnMemoria(seed.filas, seed.sinonimos, sugerencias);

  /** Buscador falso que anota las consultas y responde según el texto. */
  function buscadorFalso(respuestas: Record<string, string | null>) {
    const llamadas: string[][] = [];
    const buscar: BuscarParecidos = async (_menu, _sinonimos, consultas) => {
      llamadas.push(consultas);
      return consultas.map((c) => respuestas[c] ?? null);
    };
    return { buscar, llamadas };
  }

  it('agrega el más parecido a cada producto que no existe', async () => {
    const { buscar, llamadas } = buscadorFalso({ lasaña: 'Pizerola de Sirloin', sushi: null });
    const respuesta = await obtenerCotizacion(repo(), args('lasaña', 'sushi', 'guacamole'), buscar);

    expect(aclaraciones(respuesta)).toEqual([
      expect.objectContaining({
        tipo: 'no_existe',
        producto: 'lasaña',
        parecido: 'Pizerola de Sirloin',
      }),
      expect.objectContaining({ tipo: 'no_existe', producto: 'sushi', parecido: null }),
    ]);
    expect(llamadas).toEqual([['lasaña', 'sushi']]);
    expect(RespuestaCotizarPedidoSchema.safeParse(respuesta).success).toBe(true);
  });

  it('busca una sola vez cada texto aunque se repita', async () => {
    const { buscar, llamadas } = buscadorFalso({ lasaña: 'Pizerola de Sirloin' });
    const respuesta = await obtenerCotizacion(repo(), args('lasaña', 'lasaña'), buscar);
    expect(llamadas).toEqual([['lasaña']]);
    expect(aclaraciones(respuesta).map((a) => a.parecido)).toEqual([
      'Pizerola de Sirloin',
      'Pizerola de Sirloin',
    ]);
  });

  it('un texto sin palabras ("???") queda en null sin buscar', async () => {
    const { buscar, llamadas } = buscadorFalso({});
    const respuesta = await obtenerCotizacion(repo(), args('???'), buscar);
    expect(aclaraciones(respuesta)).toEqual([
      expect.objectContaining({ tipo: 'no_existe', parecido: null }),
    ]);
    expect(llamadas).toEqual([]);
  });

  it('no busca nada si no hay ningún no_existe de producto', async () => {
    const { buscar, llamadas } = buscadorFalso({});
    await obtenerCotizacion(repo(), args('guacamole'), buscar);
    await obtenerCotizacion(repo(), args('hamburguesa'), buscar);
    const extraSuelto = CotizarPedidoArgsSchema.parse({
      extrasSueltos: [{ extra: 'mole', cantidad: 1 }],
    });
    const respuesta = await obtenerCotizacion(repo(), extraSuelto, buscar);
    expect(aclaraciones(respuesta)[0]).not.toHaveProperty('parecido');
    expect(llamadas).toEqual([]);
  });

  it('si la búsqueda falla, cotiza igual y sin parecido', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const buscar: BuscarParecidos = () => Promise.reject(new Error('Workers AI no responde'));
    const respuesta = await obtenerCotizacion(repo(), args('lasaña'), buscar);
    expect(aclaraciones(respuesta)).toEqual([
      expect.objectContaining({ tipo: 'no_existe', producto: 'lasaña' }),
    ]);
    expect(aclaraciones(respuesta)[0]).not.toHaveProperty('parecido');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('sin buscador (crear_pedido) no trae parecido', async () => {
    const respuesta = await obtenerCotizacion(repo(), args('lasaña'));
    expect(aclaraciones(respuesta)[0]).not.toHaveProperty('parecido');
  });
});

describe('buscarParecidos', () => {
  /** Embedder de prueba que cuenta las llamadas. */
  function embedderContado() {
    const base = crearEmbedderDePrueba();
    const llamadas: string[][] = [];
    const embedder: Embedder = {
      embeber: (textos) => {
        llamadas.push(textos);
        return base.embeber(textos);
      },
    };
    return { embedder, llamadas };
  }

  it('devuelve el primero que daría buscar_menu (mismo índice y umbral), o null', async () => {
    const repoEmb = crearRepoEmbeddingsEnMemoria();
    const { embedder } = embedderContado();
    const opciones = { umbral: 0.1 };
    const { resultados } = await buscarEnMenu(
      crearRepoMenuEnMemoria(seed.filas, seed.sinonimos),
      repoEmb,
      embedder,
      'pizerola sirloin',
      opciones,
    );
    expect(resultados[0]?.nombre).toMatch(/^Pizerola/);

    const buscar = (umbral: number) =>
      buscarParecidos(menu, seed.sinonimos, repoEmb, embedder, ['pizerola sirloin'], { umbral });
    expect(await buscar(opciones.umbral)).toEqual([resultados[0]?.nombre]);
    // Si nada llega al umbral, null: no inventa.
    expect(await buscar(0.99)).toEqual([null]);
  });

  it('embebe todas las consultas en una sola llamada, aparte del índice', async () => {
    const { embedder, llamadas } = embedderContado();
    await buscarParecidos(menu, seed.sinonimos, crearRepoEmbeddingsEnMemoria(), embedder, [
      'lasaña',
      'sushi',
    ]);
    expect(llamadas.filter((l) => l.includes('lasaña'))).toEqual([['lasaña', 'sushi']]);
  });

  it('sin consultas no llama a Workers AI', async () => {
    const { embedder, llamadas } = embedderContado();
    expect(
      await buscarParecidos(menu, seed.sinonimos, crearRepoEmbeddingsEnMemoria(), embedder, []),
    ).toEqual([]);
    expect(llamadas).toEqual([]);
  });

  it('nunca devuelve un platillo que no se ve en el menú', async () => {
    const filas = structuredClone(seed.filas);
    const pizerola = filas.platillos.find((p) => p.nombre === 'Pizerola de Sirloin');
    if (pizerola) pizerola.activo = false;
    const repoEmb = crearRepoEmbeddingsEnMemoria();
    const { embedder } = embedderContado();
    // Indexado con el menú completo y buscado con la Pizerola de Sirloin oculta.
    await buscarParecidos(menu, seed.sinonimos, repoEmb, embedder, ['x']);
    const [resultado] = await buscarParecidos(
      armarMenu(filas),
      seed.sinonimos,
      repoEmb,
      embedder,
      ['pizerola sirloin'],
      { umbral: 0.1 },
    );
    expect(resultado).not.toBe('Pizerola de Sirloin');
  });

  it('propaga el error si Workers AI falla o no devuelve un vector por consulta', async () => {
    await expect(
      buscarParecidos(menu, seed.sinonimos, crearRepoEmbeddingsEnMemoria(), embedderQueFalla, [
        'x',
      ]),
    ).rejects.toThrow();
    // Indexa bien el menú, pero a la consulta no le devuelve vector.
    const base = crearEmbedderDePrueba();
    const corto: Embedder = {
      embeber: async (textos) => (textos[0] === 'x' ? [] : base.embeber(textos)),
    };
    await expect(
      buscarParecidos(menu, seed.sinonimos, crearRepoEmbeddingsEnMemoria(), corto, ['x']),
    ).rejects.toThrow('Se esperaban 1 embeddings y llegaron 0');
  });
});

describe('POST /pedidos/cotizar con sugerida y parecido', () => {
  const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
  const env = { RETELL_API_KEY: LLAVE } as Bindings;
  const repoMenu = () => crearRepoMenuEnMemoria(seed.filas, seed.sinonimos, sugerencias);

  /** Repo de embeddings que siempre dice que lo más parecido es `nombre`. */
  function embeddingsQueResponden(nombre: string, similitud = 0.9): EmbeddingsRepo {
    return {
      leerHuellas: async () => [],
      guardar: async () => {},
      buscarSimilares: async (): Promise<PlatilloSimilar[]> => [
        { idPlatillo: idDe(nombre), similitud },
      ],
    };
  }

  async function cotizar(productos: string[], reemplazos: Parameters<typeof crearApp>[0] = {}) {
    const cuerpo = JSON.stringify({
      name: 'cotizar_pedido',
      chat: { chat_id: 'chat_1' },
      args: { productos: productos.map((producto) => ({ producto, cantidad: 1 })) },
    });
    const res = await crearApp({ crearRepoMenu: repoMenu, ...reemplazos }).request(
      '/pedidos/cotizar',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Retell-Signature': await firmar(cuerpo, LLAVE, Date.now()),
        },
        body: cuerpo,
      },
      env,
    );
    expect(res.status).toBe(200);
    return aclaraciones(RespuestaCotizarPedidoSchema.parse(await res.json()));
  }

  it('un ambiguo trae la sugerida del PO', async () => {
    expect(await cotizar(['fajitas'])).toEqual([
      expect.objectContaining({ tipo: 'ambiguo', sugerida: 'Fajitas de arrachera' }),
    ]);
  });

  it('un no_existe trae el parecido de los embeddings', async () => {
    const resultado = await cotizar(['lasaña'], {
      crearEmbedder: () => crearEmbedderDePrueba(),
      crearRepoEmbeddings: () => embeddingsQueResponden('Pizerola de Sirloin'),
    });
    expect(resultado).toEqual([
      expect.objectContaining({ tipo: 'no_existe', parecido: 'Pizerola de Sirloin' }),
    ]);
  });

  it('por debajo del umbral (0.47) el parecido es null', async () => {
    const resultado = await cotizar(['lasaña'], {
      crearEmbedder: () => crearEmbedderDePrueba(),
      crearRepoEmbeddings: () => embeddingsQueResponden('Pizerola de Sirloin', 0.46),
    });
    expect(resultado[0]).toMatchObject({ parecido: null });
  });

  it('sin el binding AI responde igual, sin parecido', async () => {
    const resultado = await cotizar(['lasaña']);
    expect(resultado[0]).toMatchObject({ tipo: 'no_existe' });
    expect(resultado[0]).not.toHaveProperty('parecido');
  });

  it('si Workers AI falla responde 200 sin parecido', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const resultado = await cotizar(['lasaña'], {
      crearEmbedder: () => embedderQueFalla,
      crearRepoEmbeddings: () => crearRepoEmbeddingsEnMemoria(),
    });
    expect(resultado[0]).not.toHaveProperty('parecido');
  });

  it('Swagger documenta sugerida y parecido', async () => {
    const res = await crearApp().request('/openapi.json', {}, env);
    const texto = JSON.stringify(await res.json());
    expect(texto).toContain('"sugerida"');
    expect(texto).toContain('"parecido"');
  });
});
