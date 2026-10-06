import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

// Este test no habla con Retell: lee los archivos de agent/ como texto y
// verifica que esten bien armados. Los casos se corren a mano en el chat de
// prueba del dashboard (ver agent/CLAUDE.md, "Como probar").

const directorioDeEsteArchivo = path.dirname(fileURLToPath(import.meta.url));
const raizAgente = path.resolve(directorioDeEsteArchivo, '..');
const directorioCasos = path.join(directorioDeEsteArchivo, 'casos');

const textoNoVacio = z.string().trim().min(1);

// Formato de un caso de conversacion. Documentado en agent/CLAUDE.md.
const esquemaCaso = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  historia: z.string().regex(/^US-\d+$/),
  criterios: z.array(z.string().regex(/^C\d+$/)),
  categoria: z.enum([
    'personalidad',
    'fuera_de_alcance',
    'manipulacion',
    'sin_inventar',
    'despedida',
  ]),
  titulo: textoNoVacio,
  mensajes: z.array(textoNoVacio).min(1),
  debe: z.array(textoNoVacio).min(1),
  noDebe: z.array(textoNoVacio),
});

type Caso = z.infer<typeof esquemaCaso>;

const archivosCasos = readdirSync(directorioCasos).filter((nombre) => nombre.endsWith('.json'));

function leerJson(ruta: string): unknown {
  return JSON.parse(readFileSync(ruta, 'utf-8'));
}

function leerCaso(archivo: string): Caso {
  return esquemaCaso.parse(leerJson(path.join(directorioCasos, archivo)));
}

describe('formato de los casos (agent/tests/casos)', () => {
  it('hay casos', () => {
    expect(archivosCasos.length).toBeGreaterThan(0);
  });

  it.each(archivosCasos)('%s cumple el formato', (archivo) => {
    const resultado = esquemaCaso.safeParse(leerJson(path.join(directorioCasos, archivo)));
    expect(resultado.error?.issues ?? []).toEqual([]);
  });

  it.each(archivosCasos)('%s se llama igual que su id', (archivo) => {
    expect(archivo).toBe(`${leerCaso(archivo).id}.json`);
  });
});

describe('cobertura de US-06', () => {
  const casosUs06 = archivosCasos.map(leerCaso).filter((caso) => caso.historia === 'US-06');

  it.each(['C1', 'C3', 'C5'])('el criterio %s tiene al menos un caso', (criterio) => {
    expect(casosUs06.filter((caso) => caso.criterios.includes(criterio)).length).toBeGreaterThan(0);
  });

  it('hay al menos dos peticiones ajenas al restaurante', () => {
    const ajenas = casosUs06.filter((caso) => caso.categoria === 'fuera_de_alcance');
    expect(ajenas.length).toBeGreaterThanOrEqual(2);
  });
});

describe('prompt (agent/prompt.md)', () => {
  const prompt = readFileSync(path.join(raizAgente, 'prompt.md'), 'utf-8');

  it('nombra al restaurante', () => {
    expect(prompt).toContain('El Granero');
  });

  // docs/negocio.md -> Dinero: el modelo nunca calcula ni inventa precios.
  it('no contiene montos', () => {
    expect(prompt).not.toMatch(/\$\s*\d/);
    expect(prompt).not.toMatch(/\d\s*(pesos|mxn)/i);
  });
});

describe('configuracion (agent/retell.json)', () => {
  const esquemaConfiguracion = z.object({
    chat_agent: z.record(z.string(), z.unknown()),
    retell_llm: z.looseObject({
      begin_message: textoNoVacio,
      general_prompt: z.literal('agent/prompt.md'),
    }),
  });
  const contenido = readFileSync(path.join(raizAgente, 'retell.json'), 'utf-8');

  it('tiene los dos bloques y apunta a prompt.md', () => {
    const resultado = esquemaConfiguracion.safeParse(JSON.parse(contenido));
    expect(resultado.error?.issues ?? []).toEqual([]);
  });

  it('no guarda identificadores de la cuenta ni llaves', () => {
    expect(contenido).not.toMatch(/"(agent_id|llm_id|api_key|public_key)"/);
    expect(contenido).not.toMatch(/key_[a-z0-9]{8,}/i);
  });
});
