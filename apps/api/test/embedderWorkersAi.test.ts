import { describe, expect, it } from 'vitest';
import { crearEmbedderWorkersAi, DIMENSIONES_EMBEDDING } from '../src/lib/embedderWorkersAi';
import { MODELO_EMBEDDINGS } from '../src/services/busquedaMenu';

/** Binding `AI` falso: anota cada llamada y responde lo que diga el test. */
function aiFalso(responder: (textos: string[]) => unknown) {
  const llamadas: { modelo: string; entrada: { text: string[]; truncate_inputs?: boolean } }[] = [];
  const ai = {
    async run(modelo: string, entrada: { text: string[]; truncate_inputs?: boolean }) {
      llamadas.push({ modelo, entrada });
      return responder(entrada.text);
    },
  } as unknown as Ai;
  return { ai, llamadas };
}

const vector = (valor: number) => new Array<number>(DIMENSIONES_EMBEDDING).fill(valor);

describe('crearEmbedderWorkersAi (D50)', () => {
  it('llama a bge-m3 con todos los textos y devuelve un vector por texto, en orden', async () => {
    const { ai, llamadas } = aiFalso((textos) => ({
      shape: [textos.length, DIMENSIONES_EMBEDDING],
      data: textos.map((_, i) => vector(i)),
      pooling: 'cls',
    }));
    const vectores = await crearEmbedderWorkersAi(ai).embeber(['tacos', 'camarones']);

    expect(llamadas).toEqual([
      {
        modelo: MODELO_EMBEDDINGS,
        entrada: { text: ['tacos', 'camarones'], truncate_inputs: true },
      },
    ]);
    expect(vectores).toEqual([vector(0), vector(1)]);
  });

  it('sin textos no llama a Workers AI', async () => {
    const { ai, llamadas } = aiFalso(() => ({ data: [] }));

    expect(await crearEmbedderWorkersAi(ai).embeber([])).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });

  it('falla si un vector no tiene 1024 números (no coincidiría con la columna vector(1024))', async () => {
    const { ai } = aiFalso(() => ({ data: [[0.1, 0.2]] }));

    await expect(crearEmbedderWorkersAi(ai).embeber(['tacos'])).rejects.toThrow();
  });

  it('falla si faltan vectores o la respuesta no trae `data`', async () => {
    const sinUno = aiFalso(() => ({ data: [vector(1)] }));
    const otraForma = aiFalso(() => ({ response: [{ id: 0, score: 0.9 }] }));

    await expect(crearEmbedderWorkersAi(sinUno.ai).embeber(['a', 'b'])).rejects.toThrow(
      'devolvió 1 embeddings para 2 textos',
    );
    await expect(crearEmbedderWorkersAi(otraForma.ai).embeber(['a'])).rejects.toThrow();
  });
});
