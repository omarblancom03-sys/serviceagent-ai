import {
  MAX_RESULTADOS_INFO,
  type RespuestaInfoRestaurante,
  type ResultadoInfo,
} from '@serviceagent/shared';
import { huellaDe, MODELO_EMBEDDINGS, TAMANO_LOTE, type Embedder } from './busquedaMenu';

/*
 * Información del restaurante y preguntas frecuentes (US-17, D62). Usa el mismo RAG que
 * `buscar_menu` (D50): mismo modelo de Workers AI, mismo reindexado por huella y la misma búsqueda
 * por distancia coseno en pgvector, pero sobre las filas de `info_restaurante` (horario, dirección,
 * estacionamiento, formas de pago, alérgenos…) en lugar de los platillos.
 *
 * Los textos los aprueba el PO (seed `05_info_restaurante.sql`). El agente responde solo con lo
 * que devuelve esta búsqueda: si nada se parece, la lista viene vacía y dice que no tiene el dato.
 */

/**
 * Debajo de esta similitud coseno la entrada no responde la pregunta. Calibrado con `bge-m3` y los
 * textos del seed (D62): la respuesta correcta más baja quedó en 0.47 ("¿Dónde están?" → dirección)
 * y lo que no tiene respuesta, entre 0.42 y 0.54.
 */
export const UMBRAL_SIMILITUD_INFO = 0.45;

/**
 * Solo se devuelven las entradas que quedan a esta distancia de la mejor. Las entradas cortas se
 * parecen a todo un poco ("Reservaciones… llama al 639…" sale segunda en casi cualquier pregunta);
 * con el margen, "¿A qué hora abren?" devuelve solo el horario.
 */
export const MARGEN_SIMILITUD_INFO = 0.08;

/** Candidatos que se piden a la base antes de filtrar lo inactivo y lo que no llega al umbral. */
const CANDIDATOS_INFO = 10;

/** Una fila activa de `info_restaurante`. */
export interface EntradaInfo {
  idInfo: number;
  tema: string;
  titulo: string;
  contenido: string;
}

export interface HuellaInfo {
  idInfo: number;
  modelo: string;
  /** SHA-256 de modelo + texto: si cambia, hay que reindexar. */
  hash: string;
}

export interface NuevoEmbeddingInfo extends HuellaInfo {
  contenido: string;
  embedding: number[];
}

export interface InfoSimilar {
  idInfo: number;
  /** Similitud coseno: 1 es idéntico, 0 nada que ver. */
  similitud: number;
}

/** Acceso a la información y sus embeddings. En producción es Supabase; en los tests, memoria. */
export interface InfoRepo {
  /** Solo las filas activas. */
  leerEntradas(): Promise<EntradaInfo[]>;
  leerHuellas(): Promise<HuellaInfo[]>;
  /** Inserta o reemplaza por `idInfo`. */
  guardar(filas: NuevoEmbeddingInfo[]): Promise<void>;
  /** De la más parecida a la menos parecida, solo las del `modelo` dado. */
  buscarSimilares(embedding: number[], modelo: string, limite: number): Promise<InfoSimilar[]>;
}

/** Texto con el que se indexa una entrada: "Horario. Abrimos de lunes a domingo de…". */
export function textoDeEntrada(entrada: EntradaInfo): string {
  return `${entrada.titulo.trim()}. ${entrada.contenido.trim()}`;
}

/**
 * Indexa las entradas activas que no tienen embedding o cuyo texto (o modelo) cambió. Devuelve
 * cuántas reindexó. Las que se desactivan conservan su embedding: la búsqueda las descarta.
 */
export async function sincronizarIndiceInfo(
  entradas: readonly EntradaInfo[],
  repo: InfoRepo,
  embedder: Embedder,
  modelo: string = MODELO_EMBEDDINGS,
): Promise<number> {
  const documentos = await Promise.all(
    entradas.map(async (e) => {
      const contenido = textoDeEntrada(e);
      return { idInfo: e.idInfo, contenido, hash: await huellaDe(modelo, contenido) };
    }),
  );

  const guardadas = new Map((await repo.leerHuellas()).map((h) => [h.idInfo, h]));
  const pendientes = documentos.filter((d) => {
    const guardada = guardadas.get(d.idInfo);
    return guardada?.modelo !== modelo || guardada.hash !== d.hash;
  });

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

export interface OpcionesInfo {
  umbral?: number;
  margen?: number;
  modelo?: string;
}

/**
 * Busca en la información del restaurante lo que preguntó el cliente. Lee las entradas activas en
 * ese momento, reindexa lo que haga falta y devuelve hasta 3, de la más parecida a la menos
 * parecida: las que pasan el umbral y quedan dentro del margen de la mejor. Los errores del repo o de Workers AI se propagan (la ruta responde 500).
 */
export async function buscarInfo(
  repo: InfoRepo,
  embedder: Embedder,
  consulta: string,
  {
    umbral = UMBRAL_SIMILITUD_INFO,
    margen = MARGEN_SIMILITUD_INFO,
    modelo = MODELO_EMBEDDINGS,
  }: OpcionesInfo = {},
): Promise<RespuestaInfoRestaurante> {
  const entradas = await repo.leerEntradas();

  // El índice y el embedding de la consulta no dependen uno del otro.
  const [, embeddings] = await Promise.all([
    sincronizarIndiceInfo(entradas, repo, embedder, modelo),
    embedder.embeber([consulta]),
  ]);
  const vector = embeddings[0];
  if (!vector) throw new Error('Workers AI no devolvió el embedding de la consulta');

  const activas = new Map(entradas.map((e) => [e.idInfo, e]));
  const similares = await repo.buscarSimilares(vector, modelo, CANDIDATOS_INFO);
  const candidatas = [...similares]
    .sort((a, b) => b.similitud - a.similitud)
    .filter((s) => s.similitud >= umbral && activas.has(s.idInfo));
  const mejor = candidatas[0]?.similitud ?? 0;
  const resultados: ResultadoInfo[] = candidatas
    .filter((s) => s.similitud >= mejor - margen)
    .map((s) => activas.get(s.idInfo))
    .filter((e) => e !== undefined)
    .slice(0, MAX_RESULTADOS_INFO)
    .map(({ tema, titulo, contenido }) => ({ tema, titulo, contenido }));

  return { resultados };
}
