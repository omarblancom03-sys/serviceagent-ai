import { palabras } from '../src/lib/normalizar';
import type {
  Embedder,
  EmbeddingsRepo,
  NuevoEmbedding,
  PlatilloSimilar,
} from '../src/services/busquedaMenu';

/** Dimensiones del embedder de prueba: basta con que las palabras casi no choquen. */
const DIMENSIONES = 512;

function indiceDe(palabra: string): number {
  let hash = 0;
  for (const caracter of palabra) hash = (hash * 31 + caracter.charCodeAt(0)) % DIMENSIONES;
  return hash;
}

/** Similitud coseno de dos vectores (0 si alguno es cero). */
export function coseno(a: number[], b: number[]): number {
  let punto = 0;
  let normaA = 0;
  let normaB = 0;
  a.forEach((x, i) => {
    const y = b[i] ?? 0;
    punto += x * y;
    normaA += x * x;
    normaB += y * y;
  });
  return normaA === 0 || normaB === 0 ? 0 : punto / Math.sqrt(normaA * normaB);
}

/**
 * Embedder determinista para los tests: bolsa de palabras normalizadas (sin acentos, plurales ni
 * relleno, igual que cotizar) repartidas en 512 posiciones. Dos textos se parecen si comparten
 * palabras. No es semántico ("chela" no se parece a "cerveza"): eso se mide con Workers AI real en
 * la evaluación de `scripts/evaluarBusqueda.ts`. Cuenta cuántos textos le pidieron.
 */
export function crearEmbedderDePrueba(): Embedder & { textosEmbebidos: string[] } {
  const textosEmbebidos: string[] = [];
  return {
    textosEmbebidos,
    async embeber(textos) {
      textosEmbebidos.push(...textos);
      return textos.map((texto) => {
        const vector = new Array<number>(DIMENSIONES).fill(0);
        for (const palabra of palabras(texto)) vector[indiceDe(palabra)] = 1;
        return vector;
      });
    },
  };
}

/** Embedder que siempre falla, como Workers AI caído. */
export const embedderQueFalla: Embedder = {
  async embeber() {
    throw new Error('Workers AI no responde');
  },
};

/** `EmbeddingsRepo` en memoria: misma regla que `buscar_platillos_similares` (coseno, por modelo). */
export function crearRepoEmbeddingsEnMemoria(): EmbeddingsRepo & {
  filas: Map<number, NuevoEmbedding>;
} {
  const filas = new Map<number, NuevoEmbedding>();
  return {
    filas,
    async leerHuellas() {
      return [...filas.values()].map(({ idPlatillo, modelo, hash }) => ({
        idPlatillo,
        modelo,
        hash,
      }));
    },
    async guardar(nuevas) {
      for (const fila of nuevas) filas.set(fila.idPlatillo, fila);
    },
    async buscarSimilares(embedding, modelo, limite): Promise<PlatilloSimilar[]> {
      return [...filas.values()]
        .filter((f) => f.modelo === modelo)
        .map((f) => ({ idPlatillo: f.idPlatillo, similitud: coseno(f.embedding, embedding) }))
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, limite);
    },
  };
}
