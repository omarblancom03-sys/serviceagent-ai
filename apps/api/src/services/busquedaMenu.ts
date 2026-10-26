import {
  MAX_RESULTADOS_BUSQUEDA,
  type Platillo,
  type RespuestaBuscarMenu,
  type RespuestaMenu,
  type ResultadoBusqueda,
} from '@serviceagent/shared';
import { normalizarSuave } from '../lib/normalizar';
import { formatearPesos } from '../lib/pesos';
import { armarMenu, type MenuRepo, type Sinonimo } from './menu';

/*
 * Búsqueda semántica del menú (US-16, D50). El cliente describe lo que quiere con sus palabras
 * ("algo picoso con camarones") y se devuelven los platillos cuyo texto se parece más:
 *
 * 1. Cada platillo visible (D19) se indexa con un texto: nombre, categoría, descripción,
 *    ingredientes, presentaciones y sinónimos. Su embedding (Workers AI, `bge-m3`) se guarda en
 *    pgvector (tabla `embedding_platillo`).
 * 2. Reindexado automático: cada búsqueda compara el hash de modelo + texto de cada platillo con
 *    el guardado y recalcula solo los que faltan o cambiaron. Así un cambio al menú (US-42) se
 *    refleja en la siguiente búsqueda sin ningún paso manual.
 * 3. La consulta se convierte en embedding y la base devuelve los platillos más parecidos
 *    (distancia coseno). Se descarta lo que no llega a `UMBRAL_SIMILITUD` (así "sushi" no trae
 *    nada) y lo que ya no es visible, y se devuelven hasta 5, con precios de la base en ese momento.
 *
 * Funciones puras más dos interfaces (`Embedder`, `EmbeddingsRepo`): no saben de HTTP, de Workers
 * AI ni de Supabase, y en los tests se reemplazan por versiones en memoria.
 */

/** Modelo multilingüe de Workers AI (D50): 1024 dimensiones, bueno en español. */
export const MODELO_EMBEDDINGS = '@cf/baai/bge-m3';

/**
 * Debajo de esta similitud coseno el platillo no se parece a la consulta. Calibrado con `bge-m3` y
 * el menú real (D50, `scripts/evaluacionBusqueda.md`): el platillo correcto más bajo quedó en 0.48
 * ("queso derretido" → Queso fundido) y lo que el menú no tiene, entre 0.41 y 0.45 (ramen, lasaña);
 * "sushi" llega a 0.49 con la Torre de mariscos, que es lo más parecido que hay.
 */
export const UMBRAL_SIMILITUD = 0.47;

/** Candidatos que se piden a la base antes de filtrar lo invisible y lo que no llega al umbral. */
export const CANDIDATOS = 15;

/** Textos por llamada a Workers AI al reindexar (el menú completo son ~95). */
export const TAMANO_LOTE = 25;

/** Convierte textos en embeddings, en el mismo orden. La implementación real es Workers AI. */
export interface Embedder {
  embeber(textos: string[]): Promise<number[][]>;
}

/** Lo que se guarda de un platillo indexado, sin el vector. */
export interface HuellaEmbedding {
  idPlatillo: number;
  modelo: string;
  /** SHA-256 de modelo + texto: si cambia, hay que reindexar. */
  hash: string;
}

export interface NuevoEmbedding extends HuellaEmbedding {
  contenido: string;
  embedding: number[];
}

export interface PlatilloSimilar {
  idPlatillo: number;
  /** Similitud coseno: 1 es idéntico, 0 nada que ver. */
  similitud: number;
}

/** Acceso a los embeddings. En producción es Supabase (`lib/repoEmbeddings.ts`); en los tests, memoria. */
export interface EmbeddingsRepo {
  leerHuellas(): Promise<HuellaEmbedding[]>;
  /** Inserta o reemplaza por `idPlatillo`. */
  guardar(filas: NuevoEmbedding[]): Promise<void>;
  /** Del más parecido al menos parecido, solo los del `modelo` dado. */
  buscarSimilares(embedding: number[], modelo: string, limite: number): Promise<PlatilloSimilar[]>;
}

/** Texto que se repite en casi todo el menú y no distingue un platillo de otro. */
const RELLENO_DESCRIPCION = /\s*No incluye acompañamientos adicionales\.?/gi;

/** La variante "Único" no es una presentación real: el platillo solo tiene una. */
export function esPresentacionUnica(nombreVariante: string): boolean {
  return normalizarSuave(nombreVariante) === 'unico';
}

/**
 * Texto con el que se indexa un platillo (criterio 1: nombre, descripción e ingredientes).
 * "Hamburguesa Hawaiana. Categoría: Hamburguesas. Hamburguesa sencilla con lechuga fresca y piña.
 * Acompañada de papas. Ingredientes: Lechuga, Piña. También se pide como: hawaiana."
 */
export function textoDelPlatillo(
  platillo: Platillo,
  categoria: string,
  sinonimos: readonly string[],
): string {
  const partes = [`${platillo.nombre}.`, `Categoría: ${categoria}.`];
  const descripcion = platillo.descripcion.replace(RELLENO_DESCRIPCION, '').trim();
  if (descripcion !== '') partes.push(descripcion);
  const ingredientes = platillo.ingredientesRemovibles.map((i) => i.nombre);
  if (ingredientes.length > 0) partes.push(`Ingredientes: ${ingredientes.join(', ')}.`);
  const presentaciones = platillo.variantes
    .map((v) => v.nombre)
    .filter((nombre) => !esPresentacionUnica(nombre));
  if (presentaciones.length > 0) partes.push(`Presentaciones: ${presentaciones.join(', ')}.`);
  if (sinonimos.length > 0) partes.push(`También se pide como: ${sinonimos.join(', ')}.`);
  return partes.join(' ');
}

/** SHA-256 en hex de modelo + texto. */
export async function huellaDe(modelo: string, texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${modelo}\n${texto}`),
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface PlatilloVisible {
  platillo: Platillo;
  categoria: string;
}

/** Platillos que se ven en el menú (D19), con el nombre de su categoría. */
function platillosVisibles(menu: RespuestaMenu): Map<number, PlatilloVisible> {
  return new Map(
    menu.categorias.flatMap((c) =>
      c.platillos.map((platillo) => [platillo.id, { platillo, categoria: c.nombre }] as const),
    ),
  );
}

/**
 * Indexa los platillos visibles que no tienen embedding o cuyo texto (o modelo) cambió. Devuelve
 * cuántos reindexó. Los platillos que dejan de ser visibles conservan su embedding: la búsqueda
 * los descarta y, si vuelven sin cambios, no hay que recalcularlos.
 */
export async function sincronizarIndice(
  menu: RespuestaMenu,
  sinonimos: readonly Sinonimo[],
  repo: EmbeddingsRepo,
  embedder: Embedder,
  modelo: string = MODELO_EMBEDDINGS,
): Promise<number> {
  const frasesPorPlatillo = new Map<number, string[]>();
  for (const s of sinonimos.filter((s) => s.activo)) {
    frasesPorPlatillo.set(s.idPlatillo, [...(frasesPorPlatillo.get(s.idPlatillo) ?? []), s.frase]);
  }

  const documentos = await Promise.all(
    [...platillosVisibles(menu).values()].map(async ({ platillo, categoria }) => {
      const contenido = textoDelPlatillo(
        platillo,
        categoria,
        frasesPorPlatillo.get(platillo.id) ?? [],
      );
      return { idPlatillo: platillo.id, contenido, hash: await huellaDe(modelo, contenido) };
    }),
  );

  const guardadas = new Map((await repo.leerHuellas()).map((h) => [h.idPlatillo, h]));
  const pendientes = documentos.filter((d) => {
    const guardada = guardadas.get(d.idPlatillo);
    return guardada?.modelo !== modelo || guardada.hash !== d.hash;
  });

  // Los lotes van en paralelo: reindexar el menú completo (la primera vez, o si cambia el modelo)
  // debe caber holgado en el timeout de 10 s que Retell le da a la función.
  const lotes: (typeof pendientes)[] = [];
  for (let i = 0; i < pendientes.length; i += TAMANO_LOTE) {
    lotes.push(pendientes.slice(i, i + TAMANO_LOTE));
  }
  await Promise.all(
    lotes.map(async (lote) => {
      const vectores = await embedder.embeber(lote.map((d) => d.contenido));
      if (vectores.length !== lote.length) {
        throw new Error(`Se esperaban ${lote.length} embeddings y llegaron ${vectores.length}`);
      }
      await repo.guardar(lote.map((d, j) => ({ ...d, modelo, embedding: vectores[j] ?? [] })));
    }),
  );
  return pendientes.length;
}

/** Un resultado tal como lo recibe el agente: precios leídos de la base, formateados aquí. */
function aResultado({ platillo, categoria }: PlatilloVisible): ResultadoBusqueda {
  return {
    idPlatillo: platillo.id,
    nombre: platillo.nombre,
    categoria,
    descripcion: platillo.descripcion,
    disponible: platillo.disponible,
    precios: platillo.variantes.map((v) => ({
      presentacion: esPresentacionUnica(v.nombre) ? null : v.nombre,
      precioCentavos: v.precioCentavos,
      precioTexto: formatearPesos(v.precioCentavos),
      disponible: v.disponible,
    })),
  };
}

export interface OpcionesBusqueda {
  umbral?: number;
  modelo?: string;
}

/**
 * Busca en el menú lo que describió el cliente. Lee el menú en ese momento (precios y
 * visibilidad en vivo), reindexa lo que haga falta y devuelve hasta 5 platillos, del más
 * parecido al menos parecido. Los errores de los repos o de Workers AI se propagan (la ruta
 * responde 500).
 */
export async function buscarEnMenu(
  repoMenu: MenuRepo,
  repoEmbeddings: EmbeddingsRepo,
  embedder: Embedder,
  consulta: string,
  { umbral = UMBRAL_SIMILITUD, modelo = MODELO_EMBEDDINGS }: OpcionesBusqueda = {},
): Promise<RespuestaBuscarMenu> {
  const [filas, sinonimos] = await Promise.all([repoMenu.leerTodo(), repoMenu.leerSinonimos()]);
  const menu = armarMenu(filas);

  // El índice y el embedding de la consulta no dependen uno del otro.
  const [, embeddings] = await Promise.all([
    sincronizarIndice(menu, sinonimos, repoEmbeddings, embedder, modelo),
    embedder.embeber([consulta]),
  ]);
  const vector = embeddings[0];
  if (!vector) throw new Error('Workers AI no devolvió el embedding de la consulta');

  const visibles = platillosVisibles(menu);
  const similares = await repoEmbeddings.buscarSimilares(vector, modelo, CANDIDATOS);
  const resultados = [...similares]
    .sort((a, b) => b.similitud - a.similitud)
    .filter((s) => s.similitud >= umbral)
    .map((s) => visibles.get(s.idPlatillo))
    .filter((v) => v !== undefined)
    .slice(0, MAX_RESULTADOS_BUSQUEDA)
    .map(aResultado);

  return { resultados };
}
