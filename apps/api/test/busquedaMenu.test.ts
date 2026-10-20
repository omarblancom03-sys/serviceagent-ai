import { RespuestaBuscarMenuSchema } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { formatearPesos } from '../src/lib/pesos';
import {
  buscarEnMenu,
  esPresentacionUnica,
  MODELO_EMBEDDINGS,
  sincronizarIndice,
  TAMANO_LOTE,
  textoDelPlatillo,
  type Embedder,
} from '../src/services/busquedaMenu';
import { armarMenu, type FilasMenu, type Sinonimo } from '../src/services/menu';
import {
  crearEmbedderDePrueba,
  crearRepoEmbeddingsEnMemoria,
  embedderQueFalla,
} from './embeddingsEnMemoria';
import { crearRepoMenuEnMemoria, repoMenuQueFalla } from './menuEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

/** Menú real del seed (95 platillos), copiado para que cada test pueda cambiarlo. */
function menuReal() {
  const { filas, sinonimos } = leerSeedMenu();
  return { filas: structuredClone(filas), sinonimos: structuredClone(sinonimos) };
}

const platilloPorNombre = (filas: FilasMenu, nombre: string) => {
  const platillo = filas.platillos.find((p) => p.nombre === nombre);
  if (!platillo) throw new Error(`No está en el seed: ${nombre}`);
  return platillo;
};

/**
 * El embedder de prueba es una bolsa de palabras: sus similitudes son más bajas que las de un
 * modelo real, así que la mayoría de los tests buscan con un umbral bajo. El umbral real (D50) se
 * calibra con Workers AI en `scripts/evaluarBusqueda.ts`.
 */
const UMBRAL_DE_PRUEBA = 0.1;

async function buscar(
  consulta: string,
  {
    filas = menuReal().filas,
    sinonimos = menuReal().sinonimos,
    repo = crearRepoEmbeddingsEnMemoria(),
    embedder = crearEmbedderDePrueba() as Embedder,
    umbral = UMBRAL_DE_PRUEBA,
  }: {
    filas?: FilasMenu;
    sinonimos?: Sinonimo[];
    repo?: ReturnType<typeof crearRepoEmbeddingsEnMemoria>;
    embedder?: Embedder;
    umbral?: number;
  } = {},
) {
  const respuesta = await buscarEnMenu(
    crearRepoMenuEnMemoria(filas, sinonimos),
    repo,
    embedder,
    consulta,
    { umbral },
  );
  return RespuestaBuscarMenuSchema.parse(respuesta);
}

describe('textoDelPlatillo (criterio 1: nombre, descripción e ingredientes)', () => {
  const { filas, sinonimos } = menuReal();
  const menu = armarMenu(filas);
  const platillo = (nombre: string) => {
    for (const categoria of menu.categorias) {
      const encontrado = categoria.platillos.find((p) => p.nombre === nombre);
      if (encontrado) return { platillo: encontrado, categoria: categoria.nombre };
    }
    throw new Error(`No está en el menú: ${nombre}`);
  };
  const frases = (nombre: string) =>
    sinonimos.filter((s) => s.idPlatillo === platillo(nombre).platillo.id).map((s) => s.frase);

  it('lleva nombre, categoría, descripción, ingredientes y sinónimos', () => {
    const { platillo: hawaiana, categoria } = platillo('Hamburguesa Hawaiana');
    const texto = textoDelPlatillo(hawaiana, categoria, frases('Hamburguesa Hawaiana'));

    expect(texto).toContain('Hamburguesa Hawaiana.');
    expect(texto).toContain('Categoría: Hamburguesas.');
    expect(texto).toContain('lechuga fresca y piña');
    expect(texto).toContain('Ingredientes: Lechuga, Piña.');
    expect(texto).toContain('También se pide como:');
  });

  it('nombra las presentaciones, pero nunca la variante "Único"', () => {
    const limonada = platillo('Limonada natural');
    const hawaiana = platillo('Hamburguesa Hawaiana');

    expect(textoDelPlatillo(limonada.platillo, limonada.categoria, [])).toContain(
      'Presentaciones:',
    );
    const texto = textoDelPlatillo(hawaiana.platillo, hawaiana.categoria, []);
    expect(texto).not.toContain('Presentaciones');
    expect(texto).not.toMatch(/[ÚU]nico/);
  });

  it('quita el "No incluye acompañamientos adicionales", que no distingue un platillo de otro', () => {
    const { platillo: tbone, categoria } = platillo('T-Bone 450 gr');
    expect(tbone.descripcion).toContain('No incluye acompañamientos adicionales');
    expect(textoDelPlatillo(tbone, categoria, [])).not.toContain('No incluye');
  });

  it('reconoce la variante "Único" con o sin acento', () => {
    expect(esPresentacionUnica('Único')).toBe(true);
    expect(esPresentacionUnica('unico')).toBe(true);
    expect(esPresentacionUnica('Vaso 500 ml')).toBe(false);
  });
});

describe('sincronizarIndice (criterio 4: se reindexa solo lo que cambió)', () => {
  async function sincronizar(
    filas: FilasMenu,
    sinonimos: Sinonimo[],
    repo = crearRepoEmbeddingsEnMemoria(),
    modelo = MODELO_EMBEDDINGS,
  ) {
    const embedder = crearEmbedderDePrueba();
    const reindexados = await sincronizarIndice(
      armarMenu(filas),
      sinonimos,
      repo,
      embedder,
      modelo,
    );
    return { reindexados, embedder, repo };
  }

  it('la primera vez indexa todos los platillos visibles, en lotes', async () => {
    const { filas, sinonimos } = menuReal();
    const visibles = armarMenu(filas).categorias.flatMap((c) => c.platillos).length;
    const { reindexados, embedder, repo } = await sincronizar(filas, sinonimos);

    expect(visibles).toBe(95);
    expect(reindexados).toBe(95);
    expect(embedder.textosEmbebidos).toHaveLength(95);
    expect(repo.filas.size).toBe(95);
    expect([...repo.filas.values()].every((f) => f.modelo === MODELO_EMBEDDINGS)).toBe(true);
    expect(TAMANO_LOTE).toBeLessThan(95);
  });

  it('la segunda vez, sin cambios, no recalcula nada', async () => {
    const { filas, sinonimos } = menuReal();
    const { repo } = await sincronizar(filas, sinonimos);
    const { reindexados, embedder } = await sincronizar(filas, sinonimos, repo);

    expect(reindexados).toBe(0);
    expect(embedder.textosEmbebidos).toHaveLength(0);
  });

  it('si cambia la descripción de un platillo, reindexa solo ese', async () => {
    const { filas, sinonimos } = menuReal();
    const { repo } = await sincronizar(filas, sinonimos);
    platilloPorNombre(filas, 'Guacamole').descripcion = 'Guacamole con chile serrano y totopos.';
    const { reindexados, embedder } = await sincronizar(filas, sinonimos, repo);

    expect(reindexados).toBe(1);
    expect(embedder.textosEmbebidos[0]).toContain('chile serrano');
  });

  it('también reindexa si cambia el nombre, un ingrediente o un sinónimo', async () => {
    const { filas, sinonimos } = menuReal();
    const { repo } = await sincronizar(filas, sinonimos);
    platilloPorNombre(filas, 'Boneless').nombre = 'Boneless de pollo';
    const hawaiana = platilloPorNombre(filas, 'Hamburguesa Hawaiana');
    filas.ingredientesRemovibles.push({
      id: 999,
      idPlatillo: hawaiana.id,
      nombre: 'Jamón',
      activo: true,
    });
    sinonimos.push({
      idPlatillo: platilloPorNombre(filas, 'Horchata').id,
      frase: 'agua de arroz',
      activo: true,
    });

    expect((await sincronizar(filas, sinonimos, repo)).reindexados).toBe(3);
  });

  it('no indexa lo que no se ve en el menú (platillo inactivo)', async () => {
    const { filas, sinonimos } = menuReal();
    const horchata = platilloPorNombre(filas, 'Horchata');
    horchata.activo = false;
    const { repo, reindexados } = await sincronizar(filas, sinonimos);

    expect(reindexados).toBe(94);
    expect(repo.filas.has(horchata.id)).toBe(false);
  });

  it('si cambia el modelo, reindexa todo', async () => {
    const { filas, sinonimos } = menuReal();
    const { repo } = await sincronizar(filas, sinonimos);

    expect((await sincronizar(filas, sinonimos, repo, 'otro-modelo')).reindexados).toBe(95);
  });

  it('falla si el embedder no devuelve un vector por texto', async () => {
    const { filas, sinonimos } = menuReal();
    const incompleto: Embedder = { embeber: async (textos) => textos.slice(1).map(() => [1]) };

    await expect(
      sincronizarIndice(armarMenu(filas), sinonimos, crearRepoEmbeddingsEnMemoria(), incompleto),
    ).rejects.toThrow('Se esperaban');
  });
});

describe('buscarEnMenu (criterio 2: hasta 5 platillos con precio y disponibilidad en vivo)', () => {
  it('encuentra el platillo por lo que lleva, aunque no se diga su nombre', async () => {
    const { resultados } = await buscar('una hamburguesa con piña');

    expect(resultados[0]?.nombre).toBe('Hamburguesa Hawaiana');
    expect(resultados[0]?.categoria).toBe('Hamburguesas');
  });

  it('devuelve de 1 a 5 resultados, del más parecido al menos parecido', async () => {
    const { resultados } = await buscar('camarones');

    expect(resultados.length).toBeGreaterThan(0);
    expect(resultados.length).toBeLessThanOrEqual(5);
    expect(resultados.every((r) => /camar/i.test(`${r.nombre} ${r.descripcion}`))).toBe(true);
  });

  it('trae los precios de la base formateados y sin nombrar la variante "Único"', async () => {
    const { filas } = menuReal();
    const hawaiana = platilloPorNombre(filas, 'Hamburguesa Hawaiana');
    const precio = filas.variantes.find((v) => v.idPlatillo === hawaiana.id)?.precioCentavos ?? 0;
    const { resultados } = await buscar('hamburguesa con piña', { filas });

    expect(resultados[0]).toMatchObject({
      nombre: 'Hamburguesa Hawaiana',
      disponible: true,
      precios: [
        {
          presentacion: null,
          precioCentavos: precio,
          precioTexto: formatearPesos(precio),
          disponible: true,
        },
      ],
    });
  });

  it('con varias presentaciones, trae el precio de cada una con su nombre', async () => {
    const { resultados } = await buscar('limonada natural');
    const limonada = resultados.find((r) => r.nombre === 'Limonada natural');

    expect(limonada?.precios.length).toBeGreaterThan(1);
    expect(limonada?.precios.every((p) => p.presentacion !== null)).toBe(true);
  });

  it('el precio es el de la base en ese momento, sin reindexar', async () => {
    const { filas, sinonimos } = menuReal();
    const repo = crearRepoEmbeddingsEnMemoria();
    await buscar('hamburguesa con piña', { filas, sinonimos, repo });
    const hawaiana = platilloPorNombre(filas, 'Hamburguesa Hawaiana');
    const variante = filas.variantes.find((v) => v.idPlatillo === hawaiana.id);
    if (!variante) throw new Error('La Hawaiana no tiene variante');
    variante.precioCentavos = 19900;
    const embedder = crearEmbedderDePrueba();
    const { resultados } = await buscar('hamburguesa con piña', {
      filas,
      sinonimos,
      repo,
      embedder,
    });

    expect(resultados[0]?.precios[0]?.precioTexto).toBe('$199.00');
    expect(embedder.textosEmbebidos).toEqual(['hamburguesa con piña']);
  });

  it('nunca devuelve un platillo que ya no se ve en el menú, aunque siga indexado', async () => {
    const { filas, sinonimos } = menuReal();
    const repo = crearRepoEmbeddingsEnMemoria();
    await buscar('hamburguesa con piña', { filas, sinonimos, repo });
    platilloPorNombre(filas, 'Hamburguesa Hawaiana').activo = false;
    const { resultados } = await buscar('hamburguesa con piña', { filas, sinonimos, repo });

    expect(resultados.map((r) => r.nombre)).not.toContain('Hamburguesa Hawaiana');
    expect(repo.filas.has(platilloPorNombre(filas, 'Hamburguesa Hawaiana').id)).toBe(true);
  });

  it('si nada llega al umbral, la lista viene vacía (no inventa)', async () => {
    expect((await buscar('sushi con wasabi')).resultados).toEqual([]);
    expect((await buscar('hamburguesa con piña', { umbral: 0.99 })).resultados).toEqual([]);
  });

  it('propaga el error si falla Workers AI o la lectura del menú (la ruta responde 500)', async () => {
    await expect(buscar('tacos', { embedder: embedderQueFalla })).rejects.toThrow(
      'Workers AI no responde',
    );
    await expect(
      buscarEnMenu(
        repoMenuQueFalla,
        crearRepoEmbeddingsEnMemoria(),
        crearEmbedderDePrueba(),
        'tacos',
      ),
    ).rejects.toThrow('Supabase no responde');
  });
});
