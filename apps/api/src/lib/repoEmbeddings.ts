import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { EmbeddingsRepo } from '../services/busquedaMenu';

/* Filas de `embedding_platillo` y de la función `buscar_platillos_similares` (*_busqueda_semantica_menu.sql). */
const FilaHuellaSchema = z.object({
  id_platillo: z.number().int(),
  modelo: z.string(),
  hash_contenido: z.string(),
});

const FilaSimilarSchema = z.object({
  id_platillo: z.number().int(),
  similitud: z.number(),
});

/**
 * pgvector recibe el vector como texto `[0.1,0.2,…]`. Se manda así (y no como arreglo JSON) para no
 * depender de cómo PostgREST convierte un arreglo al tipo `vector`.
 */
const comoVector = (embedding: number[]) => `[${embedding.join(',')}]`;

/**
 * Implementación de `EmbeddingsRepo` sobre Supabase. Las huellas se leen sin el vector (son 1024
 * números por platillo y aquí no hacen falta); la comparación la hace la base con
 * `buscar_platillos_similares`.
 */
export function crearRepoEmbeddings(cliente: SupabaseClient): EmbeddingsRepo {
  return {
    async leerHuellas() {
      const { data, error } = await cliente
        .from('embedding_platillo')
        .select('id_platillo, modelo, hash_contenido');
      if (error) throw new Error(`No se pudo leer embedding_platillo: ${error.message}`);
      return z
        .array(FilaHuellaSchema)
        .parse(data)
        .map((f) => ({ idPlatillo: f.id_platillo, modelo: f.modelo, hash: f.hash_contenido }));
    },

    async guardar(filas) {
      if (filas.length === 0) return;
      const { error } = await cliente.from('embedding_platillo').upsert(
        filas.map((f) => ({
          id_platillo: f.idPlatillo,
          modelo: f.modelo,
          hash_contenido: f.hash,
          contenido: f.contenido,
          embedding: comoVector(f.embedding),
          actualizado_en: new Date().toISOString(),
        })),
        { onConflict: 'id_platillo' },
      );
      if (error) throw new Error(`No se pudo guardar embedding_platillo: ${error.message}`);
    },

    async buscarSimilares(embedding, modelo, limite) {
      const { data, error } = await cliente.rpc('buscar_platillos_similares', {
        p_embedding: comoVector(embedding),
        p_modelo: modelo,
        p_limite: limite,
      });
      if (error) throw new Error(`No se pudo buscar en embedding_platillo: ${error.message}`);
      return z
        .array(FilaSimilarSchema)
        .parse(data)
        .map((f) => ({ idPlatillo: f.id_platillo, similitud: f.similitud }));
    },
  };
}
