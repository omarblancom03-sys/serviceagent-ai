import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { InfoRepo } from '../services/infoRestaurante';

/* Filas de `info_restaurante`, `embedding_info` y `buscar_info_similar` (*_info_restaurante.sql). */
const FilaInfoSchema = z.object({
  id_info: z.number().int(),
  tema: z.string(),
  titulo: z.string(),
  contenido: z.string(),
});

const FilaHuellaSchema = z.object({
  id_info: z.number().int(),
  modelo: z.string(),
  hash_contenido: z.string(),
});

const FilaSimilarSchema = z.object({
  id_info: z.number().int(),
  similitud: z.number(),
});

/** pgvector recibe el vector como texto `[0.1,0.2,…]`, igual que en `repoEmbeddings.ts`. */
const comoVector = (embedding: number[]) => `[${embedding.join(',')}]`;

/** Implementación de `InfoRepo` sobre Supabase. */
export function crearRepoInfoRestaurante(cliente: SupabaseClient): InfoRepo {
  return {
    async leerEntradas() {
      const { data, error } = await cliente
        .from('info_restaurante')
        .select('id_info, tema, titulo, contenido')
        .eq('activo', true)
        .order('id_info');
      if (error) throw new Error(`No se pudo leer info_restaurante: ${error.message}`);
      return z
        .array(FilaInfoSchema)
        .parse(data)
        .map((f) => ({
          idInfo: f.id_info,
          tema: f.tema,
          titulo: f.titulo,
          contenido: f.contenido,
        }));
    },

    async leerHuellas() {
      const { data, error } = await cliente
        .from('embedding_info')
        .select('id_info, modelo, hash_contenido');
      if (error) throw new Error(`No se pudo leer embedding_info: ${error.message}`);
      return z
        .array(FilaHuellaSchema)
        .parse(data)
        .map((f) => ({ idInfo: f.id_info, modelo: f.modelo, hash: f.hash_contenido }));
    },

    async guardar(filas) {
      if (filas.length === 0) return;
      const { error } = await cliente.from('embedding_info').upsert(
        filas.map((f) => ({
          id_info: f.idInfo,
          modelo: f.modelo,
          hash_contenido: f.hash,
          contenido: f.contenido,
          embedding: comoVector(f.embedding),
          actualizado_en: new Date().toISOString(),
        })),
        { onConflict: 'id_info' },
      );
      if (error) throw new Error(`No se pudo guardar embedding_info: ${error.message}`);
    },

    async buscarSimilares(embedding, modelo, limite) {
      const { data, error } = await cliente.rpc('buscar_info_similar', {
        p_embedding: comoVector(embedding),
        p_modelo: modelo,
        p_limite: limite,
      });
      if (error) throw new Error(`No se pudo buscar en embedding_info: ${error.message}`);
      return z
        .array(FilaSimilarSchema)
        .parse(data)
        .map((f) => ({ idInfo: f.id_info, similitud: f.similitud }));
    },
  };
}
