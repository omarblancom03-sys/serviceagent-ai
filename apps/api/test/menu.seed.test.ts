import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Este test no se conecta a Supabase: lee los archivos .sql del seed como
// texto y verifica que esten bien armados (US-02). Es una validacion
// estatica, no una prueba de integracion contra la base de datos real.

const directorioDeEsteArchivo = path.dirname(fileURLToPath(import.meta.url));
const raizRepo = path.resolve(directorioDeEsteArchivo, '../../..');

const rutaSeedMenu = path.join(raizRepo, 'supabase/seed/01_menu_el_granero.sql');
const rutaSeedTiempos = path.join(raizRepo, 'supabase/seed/03_tiempos_preparacion_menu.sql');

const contenidoMenu = readFileSync(rutaSeedMenu, 'utf-8');
const contenidoTiempos = readFileSync(rutaSeedTiempos, 'utf-8');

function extraerBloque(contenido: string, inicio: string, fin: string): string {
  const i = contenido.indexOf(inicio);
  const j = contenido.indexOf(fin, i);
  return contenido.slice(i, j === -1 ? undefined : j);
}

describe('seed del menu (01_menu_el_granero.sql)', () => {
  const bloqueCategorias = extraerBloque(contenidoMenu, '1) CATEGORIAS', '2) PLATILLOS');
  const categorias = [...bloqueCategorias.matchAll(/\('([^']+)'\)/g)].map((m) => m[1]);

  const bloquePlatillos = extraerBloque(contenidoMenu, '2) PLATILLOS', '3) VARIANTES');
  const platillos = [...bloquePlatillos.matchAll(/\('([^']+)',\s*'([^']+)',\s*'/g)].map((m) => ({
    categoria: m[1],
    nombre: m[2],
  }));

  const bloqueVariantes = extraerBloque(contenidoMenu, '3) VARIANTES', '4) SINONIMOS');
  const variantes = [...bloqueVariantes.matchAll(/\n\s*\('([^']+)',\s*'([^']+)',\s*\d+\)/g)].map(
    (m) => ({ platillo: m[1], nombre: m[2] }),
  );
  const nombresConVariante = new Set(variantes.map((v) => v.platillo));

  const bloqueSinonimos = extraerBloque(contenidoMenu, '4) SINONIMOS', '5) EXTRAS');
  const nombresConSinonimo = new Set(
    [...bloqueSinonimos.matchAll(/\('([^']+)',\s*'[^']+'\)/g)].map((m) => m[1]),
  );

  const bloqueExtras = extraerBloque(contenidoMenu, '5) EXTRAS', contenidoMenu.length.toString());
  const extras = [...bloqueExtras.matchAll(/\('([^']+)',\s*(\d+),/g)].map((m) => ({
    nombre: m[1],
    precioCentavos: Number(m[2]),
  }));

  it('declara las 16 categorias esperadas', () => {
    expect(categorias).toHaveLength(16);
  });

  it('carga los 95 platillos esperados', () => {
    expect(platillos).toHaveLength(95);
  });

  it('no repite ningun nombre de platillo', () => {
    const nombres = platillos.map((p) => p.nombre);
    const unicos = new Set(nombres);
    expect(unicos.size).toBe(nombres.length);
  });

  it('cada platillo pertenece a una categoria que si esta declarada', () => {
    const categoriasUsadas = new Set(platillos.map((p) => p.categoria));
    for (const categoria of categoriasUsadas) {
      expect(categorias).toContain(categoria);
    }
  });

  it('todo platillo tiene al menos una variante (con precio)', () => {
    const sinVariante = platillos.filter((p) => !nombresConVariante.has(p.nombre));
    expect(sinVariante).toEqual([]);
  });

  it('no repite ningun par (platillo, variante)', () => {
    // Con "on conflict ... do update", Postgres falla si el mismo par viene
    // dos veces en un solo insert ("cannot affect row a second time").
    expect(variantes).toHaveLength(118);
    const pares = variantes.map((v) => `${v.platillo} | ${v.nombre}`);
    const repetidos = pares.filter((par, i) => pares.indexOf(par) !== i);
    expect(repetidos).toEqual([]);
  });

  it('todo platillo tiene al menos un sinonimo', () => {
    const sinSinonimo = platillos.filter((p) => !nombresConSinonimo.has(p.nombre));
    expect(sinSinonimo).toEqual([]);
  });

  it('carga los 5 extras esperados', () => {
    expect(extras).toHaveLength(5);
  });

  it('todos los precios de extras son positivos', () => {
    for (const extra of extras) {
      expect(extra.precioCentavos).toBeGreaterThan(0);
    }
  });
});

describe('seed de tiempos de preparacion (03_tiempos_preparacion_menu.sql)', () => {
  const filas = [...contenidoTiempos.matchAll(/\('([^']+)',\s*(\d+)\)/g)].map((m) => ({
    categoria: m[1],
    minutos: Number(m[2]),
  }));

  it('trae exactamente las 16 categorias, sin repetir ninguna', () => {
    const nombres = filas.map((f) => f.categoria);
    expect(new Set(nombres).size).toBe(16);
    expect(nombres).toHaveLength(16);
  });

  it('usa exactamente los mismos nombres de categoria que el seed del menu', () => {
    // Si un nombre difiere (acento, mayuscula), el update no toca esos
    // platillos y su tiempo_estimado_min se queda en NULL sin avisar.
    const bloqueCategorias = extraerBloque(contenidoMenu, '1) CATEGORIAS', '2) PLATILLOS');
    const categoriasMenu = [...bloqueCategorias.matchAll(/\('([^']+)'\)/g)].map((m) => m[1]);
    const categoriasTiempos = filas.map((f) => f.categoria);
    expect([...categoriasTiempos].sort()).toEqual([...categoriasMenu].sort());
  });

  it('todos los tiempos son multiplos de 5 y mayores que cero', () => {
    for (const fila of filas) {
      expect(fila.minutos).toBeGreaterThan(0);
      expect(fila.minutos % 5).toBe(0);
    }
  });
});
