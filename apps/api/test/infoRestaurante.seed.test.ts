import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSULTA_MAX } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';

// Este test no se conecta a Supabase: lee el seed como texto y revisa que esté bien armado (US-17).

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const seed = readFileSync(path.join(raizRepo, 'supabase/seed/05_info_restaurante.sql'), 'utf-8');
const config = readFileSync(path.join(raizRepo, 'supabase/config.toml'), 'utf-8');

/** Filas del `values`: `('tema', 'Título', 'Contenido')`, cada texto entre comillas simples. */
const filas = [...seed.matchAll(/\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\s*\)/g)].map((m) => ({
  tema: m[1] ?? '',
  titulo: m[2] ?? '',
  contenido: m[3] ?? '',
}));

describe('seed de info_restaurante (05_info_restaurante.sql)', () => {
  it('lee las 8 filas (si un texto trae un apóstrofo escapado, la regex se saltaría una)', () => {
    expect(filas).toHaveLength(8);
  });

  it('cubre los temas del criterio 4 de US-17', () => {
    const temas = filas.map((f) => f.tema);
    for (const tema of [
      'horario',
      'direccion',
      'telefono',
      'estacionamiento',
      'formas_pago',
      'alergenos',
    ]) {
      expect(temas).toContain(tema);
    }
  });

  it('cada tema aparece una sola vez y con el formato de la columna', () => {
    const temas = filas.map((f) => f.tema);
    expect(new Set(temas).size).toBe(temas.length);
    for (const tema of temas) expect(tema).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('ningún texto está vacío', () => {
    for (const fila of filas) {
      expect(fila.titulo.trim()).not.toBe('');
      expect(fila.contenido.trim()).not.toBe('');
    }
  });

  it('el texto de alérgenos nunca asegura que un platillo sea seguro', () => {
    const alergenos = filas.find((f) => f.tema === 'alergenos')?.contenido ?? '';
    expect(alergenos).toMatch(/no podemos garantizar/i);
    expect(alergenos).toMatch(/personal/i);
  });

  it('se puede correr varias veces (on conflict) y está en config.toml', () => {
    expect(seed).toMatch(/on conflict \(tema\) do update/i);
    expect(config).toContain('./seed/05_info_restaurante.sql');
  });

  it('el título más largo cabe en una consulta (el agente puede buscar por el nombre del tema)', () => {
    for (const fila of filas) expect(fila.titulo.length).toBeLessThanOrEqual(CONSULTA_MAX);
  });
});
