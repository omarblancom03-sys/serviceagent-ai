import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  llavePlural,
  normalizarExtra,
  normalizarSinRelleno,
  normalizarSuave,
  palabras,
} from '../src/lib/normalizar';

describe('normalizarSuave', () => {
  it('quita acentos, la tilde de la ñ, mayúsculas, signos y espacios de más', () => {
    expect(normalizarSuave('  Papa con CHAMPIÑÓN ')).toBe('papa con champinon');
    expect(normalizarSuave('T-Bone')).toBe(normalizarSuave('t bone'));
    expect(normalizarSuave('Cóctel   de  camarón')).toBe('coctel de camaron');
  });

  it.each([
    ['hamburguesas', 'hamburguesa'],
    ['frijoles', 'frijol'],
    ['camarones', 'camaron'],
    ['postres', 'postre'],
    ['brownies', 'brownie'],
    ['tacos', 'taco'],
  ])('lleva el plural "%s" y el singular "%s" a la misma llave', (plural, singular) => {
    expect(normalizarSuave(plural)).toBe(normalizarSuave(singular));
  });

  it('no toca palabras de 3 letras ni con dígitos', () => {
    expect(llavePlural('res')).toBe('res');
    expect(llavePlural('mas')).toBe('mas');
    expect(palabras('T-Bone 450 gr').slice(-2)).toEqual(['450', 'gr']);
  });

  it('respeta las palabras de relleno', () => {
    expect(normalizarSuave('el granero')).toBe('el granero');
  });
});

describe('normalizarSinRelleno y palabras', () => {
  it.each([
    ['la de chipotle', 'chipotle'],
    ['una orden de hamburguesas algodoneros', 'hamburguesa algodonero'],
    ['quiero dos órdenes de tacos', 'dos taco'],
    ['el granero', 'granero'],
  ])('"%s" queda igual que "%s"', (texto, esperado) => {
    // Se compara contra la llave del texto esperado: la llave no es una palabra real
    // ("chipotle" → "chipotl"), solo sirve para comparar.
    expect(normalizarSinRelleno(texto)).toBe(normalizarSuave(esperado));
  });

  it('conserva "sin", números y unidades, que sí distinguen platillos y variantes', () => {
    expect(palabras('Jarra 2000 ml sin hielo')).toEqual(['jarra', '2000', 'ml', 'sin', 'hielo']);
  });

  it('un texto de puro relleno queda vacío', () => {
    expect(palabras('la de')).toEqual([]);
  });
});

describe('normalizarExtra', () => {
  it('ignora lo que va entre paréntesis y normaliza igual que el resto', () => {
    expect(normalizarExtra('Espuelas (camarones)')).toBe(normalizarExtra('espuelas'));
    expect(normalizarExtra('Toreados')).toBe(normalizarExtra('toreado'));
  });
});

/*
 * Contra el seed real: ningún texto (nombre o sinónimo) puede llevar a dos platillos distintos en
 * el nivel suave. Si un sinónimo nuevo o un cambio de normalización lo rompe, este test avisa.
 */
describe('normalización sobre el seed del menú', () => {
  const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const seed = readFileSync(path.join(raizRepo, 'supabase/seed/01_menu_el_granero.sql'), 'utf-8');
  const bloque = (inicio: string, fin: string) =>
    seed.slice(seed.indexOf(inicio), seed.indexOf(fin));
  /** `('A', 'B'...` → [A, B]. En platillos, A es la categoría; en sinónimos, el platillo. */
  const pares = (texto: string): [string, string][] =>
    [...texto.matchAll(/\('([^']+)',\s*'([^']+)'/g)].map((m) => [m[1] ?? '', m[2] ?? '']);

  const nombres = pares(bloque('2) PLATILLOS', '3) VARIANTES')).map(([, nombre]) => nombre);
  const sinonimos = pares(bloque('4) SINONIMOS', '5) EXTRAS'));
  /** [platillo, texto]: cada nombre oficial y cada sinónimo. */
  const textos: [string, string][] = [
    ...nombres.map((nombre): [string, string] => [nombre, nombre]),
    ...sinonimos,
  ];

  /** Llave → platillos distintos que la producen. */
  function indice(normalizar: (texto: string) => string) {
    const resultado = new Map<string, Set<string>>();
    for (const [platillo, texto] of textos) {
      const llave = normalizar(texto);
      resultado.set(llave, (resultado.get(llave) ?? new Set()).add(platillo));
    }
    return resultado;
  }

  const colisiones = (mapa: Map<string, Set<string>>) =>
    [...mapa].filter(([, platillos]) => platillos.size > 1).map(([llave]) => llave);

  it('lee los 95 platillos y sus sinónimos', () => {
    expect(nombres).toHaveLength(95);
    expect(sinonimos.length).toBeGreaterThan(100);
  });

  it('no tiene colisiones en el nivel suave', () => {
    expect(colisiones(indice(normalizarSuave))).toEqual([]);
  });

  it('sin relleno, la única colisión es "granero" (por eso el paso 1 va primero en suave)', () => {
    expect(colisiones(indice(normalizarSinRelleno))).toEqual(['granero']);
  });

  /*
   * DECISIÓN DE DATOS PENDIENTE (PO): el sinónimo 'papas' es de Papas francesas, y "papa" y
   * "papas" comparten llave. Con el seed actual, "papa" coincide exacto SOLO con Papas francesas,
   * así que el paso 1 la resolvería sin preguntar, aunque hay 7 papas asadas. Si el PO cambia el
   * sinónimo, este test cambia con él.
   */
  it('"papa" y "papas" comparten llave y hoy solo coinciden con Papas francesas', () => {
    expect(normalizarSuave('papa')).toBe(normalizarSuave('papas'));
    expect([...(indice(normalizarSuave).get(normalizarSuave('papa')) ?? [])]).toEqual([
      'Papas francesas',
    ]);
  });
});
