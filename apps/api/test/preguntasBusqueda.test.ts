import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { leerSeedMenu } from './seedEnMemoria';

/*
 * Las preguntas de la evaluación de la búsqueda (criterio 5 de US-16) se corren a mano contra
 * Workers AI (`scripts/evaluarBusqueda.ts`). Este test solo revisa que el archivo esté bien armado:
 * si un platillo cambia de nombre en el seed, falla aquí y no en la evaluación.
 */
const ArchivoSchema = z.strictObject({
  nota: z.string().min(1),
  preguntas: z
    .array(
      z.strictObject({
        consulta: z.string().trim().min(1),
        correctos: z.array(z.string().min(1)).min(1),
        porque: z.string().min(1).optional(),
      }),
    )
    .length(20),
  sinResultados: z.array(z.string().trim().min(1)).min(1),
});

const archivo = ArchivoSchema.parse(
  JSON.parse(readFileSync(new URL('../scripts/preguntasBusqueda.json', import.meta.url), 'utf-8')),
);
const nombresDelMenu = new Set(leerSeedMenu().filas.platillos.map((p) => p.nombre));

describe('preguntas de la evaluación de la búsqueda (scripts/preguntasBusqueda.json)', () => {
  it('son 20 y no se repiten', () => {
    const consultas = archivo.preguntas.map((p) => p.consulta.toLowerCase());
    expect(new Set(consultas).size).toBe(20);
  });

  it.each(archivo.preguntas)('"$consulta": sus correctos existen en el menú', ({ correctos }) => {
    expect(correctos.filter((nombre) => !nombresDelMenu.has(nombre))).toEqual([]);
  });

  it.each(archivo.preguntas)(
    '"$consulta" usa palabras del cliente, no el nombre exacto del platillo',
    ({ consulta, correctos }) => {
      expect(correctos.map((n) => n.toLowerCase())).not.toContain(consulta.toLowerCase());
    },
  );

  it('lo que el menú no tiene no es el nombre de un platillo', () => {
    expect(archivo.sinResultados.filter((c) => nombresDelMenu.has(c))).toEqual([]);
  });
});
