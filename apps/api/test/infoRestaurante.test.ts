import { RespuestaInfoRestauranteSchema } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { MODELO_EMBEDDINGS, type Embedder } from '../src/services/busquedaMenu';
import {
  buscarInfo,
  sincronizarIndiceInfo,
  textoDeEntrada,
  UMBRAL_SIMILITUD_INFO,
} from '../src/services/infoRestaurante';
import { crearEmbedderDePrueba, embedderQueFalla } from './embeddingsEnMemoria';
import { crearRepoInfoEnMemoria, ENTRADAS_DE_PRUEBA, repoInfoQueFalla } from './infoEnMemoria';

/**
 * El embedder de prueba es una bolsa de palabras: sus similitudes son más bajas que las de un
 * modelo real, así que se busca con un umbral bajo. El umbral real (D62) se calibra con Workers AI.
 */
const UMBRAL_DE_PRUEBA = 0.1;

async function buscar(
  consulta: string,
  {
    repo = crearRepoInfoEnMemoria(),
    embedder = crearEmbedderDePrueba() as Embedder,
    umbral = UMBRAL_DE_PRUEBA,
  }: {
    repo?: ReturnType<typeof crearRepoInfoEnMemoria>;
    embedder?: Embedder;
    umbral?: number;
  } = {},
) {
  const respuesta = await buscarInfo(repo, embedder, consulta, { umbral });
  expect(RespuestaInfoRestauranteSchema.safeParse(respuesta).success).toBe(true);
  return respuesta.resultados;
}

describe('textoDeEntrada', () => {
  it('une el título y el contenido', () => {
    expect(
      textoDeEntrada({ idInfo: 1, tema: 'x', titulo: ' Horario ', contenido: ' Abrimos. ' }),
    ).toBe('Horario. Abrimos.');
  });
});

describe('sincronizarIndiceInfo (se reindexa solo lo que cambió)', () => {
  it('la primera vez indexa todas las entradas activas', async () => {
    const repo = crearRepoInfoEnMemoria();
    const embedder = crearEmbedderDePrueba();

    expect(await sincronizarIndiceInfo(repo.entradas, repo, embedder)).toBe(4);
    expect(repo.filas.size).toBe(4);
    expect(repo.filas.get(1)?.modelo).toBe(MODELO_EMBEDDINGS);
  });

  it('la segunda vez, sin cambios, no recalcula nada', async () => {
    const repo = crearRepoInfoEnMemoria();
    const embedder = crearEmbedderDePrueba();
    await sincronizarIndiceInfo(repo.entradas, repo, embedder);

    expect(await sincronizarIndiceInfo(repo.entradas, repo, embedder)).toBe(0);
    expect(embedder.textosEmbebidos).toHaveLength(4);
  });

  it('si cambia el contenido o el título de una entrada, reindexa solo esa', async () => {
    const repo = crearRepoInfoEnMemoria();
    const embedder = crearEmbedderDePrueba();
    await sincronizarIndiceInfo(repo.entradas, repo, embedder);

    repo.entradas[0]!.contenido = 'Abrimos de martes a domingo.';
    repo.entradas[2]!.titulo = 'Dónde estacionarse';

    expect(await sincronizarIndiceInfo(repo.entradas, repo, embedder)).toBe(2);
    expect(repo.filas.get(1)?.contenido).toBe('Horario. Abrimos de martes a domingo.');
  });

  it('si cambia el modelo, reindexa todo', async () => {
    const repo = crearRepoInfoEnMemoria();
    const embedder = crearEmbedderDePrueba();
    await sincronizarIndiceInfo(repo.entradas, repo, embedder);

    expect(await sincronizarIndiceInfo(repo.entradas, repo, embedder, 'otro-modelo')).toBe(4);
  });

  it('falla si el embedder no devuelve un vector por texto', async () => {
    const repo = crearRepoInfoEnMemoria();
    const incompleto: Embedder = { embeber: async () => [[1]] };

    await expect(sincronizarIndiceInfo(repo.entradas, repo, incompleto)).rejects.toThrow(
      'Se esperaban 4 embeddings y llegaron 1',
    );
  });
});

describe('buscarInfo', () => {
  it('encuentra la entrada que responde la pregunta, con su texto tal cual', async () => {
    const resultados = await buscar('¿Hay estacionamiento?');

    expect(resultados[0]).toEqual({
      tema: 'estacionamiento',
      titulo: 'Estacionamiento',
      contenido: 'Hay estacionamiento gratuito frente al restaurante.',
    });
  });

  it('devuelve como máximo 3 entradas, de la más parecida a la menos parecida', async () => {
    // Sin umbral ni margen: el corte en 3 lo hace solo el tope.
    const similitudes: Record<number, number> = { 1: 0.4, 2: 0.9, 3: 0.6, 4: 0.8 };
    const repo = crearRepoInfoEnMemoria();
    repo.buscarSimilares = async () =>
      Object.entries(similitudes).map(([id, similitud]) => ({ idInfo: Number(id), similitud }));

    const resultados = await buscarInfo(repo, crearEmbedderDePrueba(), 'todo', {
      umbral: 0,
      margen: 1,
    });

    expect(resultados.resultados.map((r) => r.tema)).toEqual([
      'direccion',
      'alergenos',
      'estacionamiento',
    ]);
  });

  it('solo devuelve las que quedan dentro del margen de la mejor', async () => {
    // Similitudes fijas: horario 0.72, dirección 0.30, estacionamiento 0.53 y alérgenos 0.70.
    const similitudes: Record<number, number> = { 1: 0.72, 2: 0.3, 3: 0.53, 4: 0.7 };
    const repo = crearRepoInfoEnMemoria();
    repo.buscarSimilares = async () =>
      Object.entries(similitudes).map(([id, similitud]) => ({ idInfo: Number(id), similitud }));

    const resultados = await buscar('¿a qué hora abren?', { repo, umbral: 0.45 });

    expect(resultados.map((r) => r.tema)).toEqual(['horario', 'alergenos']);
  });

  it('el margen se mide contra la mejor entrada activa, no contra una desactivada', async () => {
    const repo = crearRepoInfoEnMemoria();
    repo.buscarSimilares = async () => [
      { idInfo: 99, similitud: 0.9 },
      { idInfo: 1, similitud: 0.6 },
    ];

    expect((await buscar('horario', { repo, umbral: 0.45 })).map((r) => r.tema)).toEqual([
      'horario',
    ]);
  });

  it('si nada llega al umbral, la lista viene vacía (no inventa)', async () => {
    expect(await buscar('¿tienen wifi?')).toEqual([]);
  });

  it('nunca devuelve una entrada desactivada, aunque siga indexada', async () => {
    const repo = crearRepoInfoEnMemoria();
    expect((await buscar('estacionamiento', { repo }))[0]?.tema).toBe('estacionamiento');

    repo.entradas = repo.entradas.filter((e) => e.tema !== 'estacionamiento');

    expect((await buscar('estacionamiento', { repo })).map((r) => r.tema)).not.toContain(
      'estacionamiento',
    );
    expect(repo.filas.has(3)).toBe(true);
  });

  it('el texto es el de la base en ese momento', async () => {
    const repo = crearRepoInfoEnMemoria();
    await buscar('horario', { repo });
    repo.entradas[0]!.contenido = 'Abrimos de lunes a domingo de 1 de la tarde a 10 de la noche.';

    expect((await buscar('horario', { repo }))[0]?.contenido).toContain('10 de la noche');
  });

  it('el umbral real es más alto que el de prueba', () => {
    expect(UMBRAL_SIMILITUD_INFO).toBeGreaterThan(UMBRAL_DE_PRUEBA);
  });

  it('propaga el error si falla Workers AI o la lectura de la base (la ruta responde 500)', async () => {
    await expect(buscarInfo(crearRepoInfoEnMemoria(), embedderQueFalla, 'horario')).rejects.toThrow(
      'Workers AI no responde',
    );
    await expect(buscarInfo(repoInfoQueFalla, crearEmbedderDePrueba(), 'horario')).rejects.toThrow(
      'Supabase no responde',
    );
  });

  it('con la información de prueba completa, cada tema se encuentra con su nombre', async () => {
    for (const entrada of ENTRADAS_DE_PRUEBA) {
      expect((await buscar(entrada.titulo))[0]?.tema).toBe(entrada.tema);
    }
  });
});
