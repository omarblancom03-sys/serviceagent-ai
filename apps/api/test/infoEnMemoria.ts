import type {
  EntradaInfo,
  InfoRepo,
  InfoSimilar,
  NuevoEmbeddingInfo,
} from '../src/services/infoRestaurante';
import { coseno } from './embeddingsEnMemoria';

/**
 * Información de prueba con la forma del seed `05_info_restaurante.sql`. Los textos son de
 * ejemplo: los reales los aprueba el PO.
 */
export const ENTRADAS_DE_PRUEBA: EntradaInfo[] = [
  {
    idInfo: 1,
    tema: 'horario',
    titulo: 'Horario',
    contenido: 'Abrimos de lunes a domingo de 1 de la tarde a 11 de la noche.',
  },
  {
    idInfo: 2,
    tema: 'direccion',
    titulo: 'Dirección y ubicación',
    contenido: 'Estamos en la avenida de ejemplo 123, colonia Centro.',
  },
  {
    idInfo: 3,
    tema: 'estacionamiento',
    titulo: 'Estacionamiento',
    contenido: 'Hay estacionamiento gratuito frente al restaurante.',
  },
  {
    idInfo: 4,
    tema: 'alergenos',
    titulo: 'Alérgenos y alergias',
    contenido: 'No podemos garantizar que un platillo esté libre de algún alérgeno.',
  },
];

/** `InfoRepo` en memoria: misma regla que `buscar_info_similar` (coseno, por modelo). */
export function crearRepoInfoEnMemoria(entradas: EntradaInfo[] = ENTRADAS_DE_PRUEBA): InfoRepo & {
  entradas: EntradaInfo[];
  filas: Map<number, NuevoEmbeddingInfo>;
} {
  const filas = new Map<number, NuevoEmbeddingInfo>();
  const repo = {
    entradas: structuredClone(entradas),
    filas,
    async leerEntradas() {
      return structuredClone(repo.entradas);
    },
    async leerHuellas() {
      return [...filas.values()].map(({ idInfo, modelo, hash }) => ({ idInfo, modelo, hash }));
    },
    async guardar(nuevas: NuevoEmbeddingInfo[]) {
      for (const fila of nuevas) filas.set(fila.idInfo, fila);
    },
    async buscarSimilares(embedding: number[], modelo: string, limite: number) {
      return [...filas.values()]
        .filter((f) => f.modelo === modelo)
        .map((f): InfoSimilar => ({ idInfo: f.idInfo, similitud: coseno(f.embedding, embedding) }))
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, limite);
    },
  };
  return repo;
}

/** Repo que falla al leer, como Supabase caído. */
export const repoInfoQueFalla: InfoRepo = {
  async leerEntradas() {
    throw new Error('Supabase no responde');
  },
  async leerHuellas() {
    return [];
  },
  async guardar() {},
  async buscarSimilares() {
    return [];
  },
};
