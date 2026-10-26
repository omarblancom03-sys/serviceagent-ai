import { z } from 'zod';
import { MODELO_EMBEDDINGS, type Embedder } from '../services/busquedaMenu';

/** Dimensiones de `bge-m3`: deben coincidir con la columna `vector(1024)` de `embedding_platillo`. */
export const DIMENSIONES_EMBEDDING = 1024;

/** Lo que responde Workers AI a `{ text: [...] }`: un vector por texto, en el mismo orden. */
const SalidaEmbeddingsSchema = z.object({
  data: z.array(z.array(z.number()).length(DIMENSIONES_EMBEDDING)),
});

/**
 * `Embedder` sobre el binding `AI` de Workers AI (D50). Corta los textos demasiado largos en vez de
 * fallar (`truncate_inputs`) y valida la respuesta: si no trae un vector de 1024 números por texto,
 * lanza un error (la ruta responde 500) en lugar de guardar o comparar basura.
 */
export function crearEmbedderWorkersAi(ai: Ai): Embedder {
  return {
    async embeber(textos) {
      if (textos.length === 0) return [];
      const respuesta = await ai.run(MODELO_EMBEDDINGS, { text: textos, truncate_inputs: true });
      const { data } = SalidaEmbeddingsSchema.parse(respuesta);
      if (data.length !== textos.length) {
        throw new Error(
          `Workers AI devolvió ${data.length} embeddings para ${textos.length} textos`,
        );
      }
      return data;
    },
  };
}
