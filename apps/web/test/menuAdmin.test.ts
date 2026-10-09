import { RespuestaMenuSchema, type Platillo } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  coincideNombre,
  filtrarMenu,
  formatearHora,
  formatearPesos,
  normalizarTexto,
  resumirMenu,
} from '../src/lib/menuAdmin';

function platillo(id: number, nombre: string, idCategoria: number, variantes = 1): Platillo {
  return {
    id,
    nombre,
    descripcion: '',
    imagen: null,
    tiempoEstimadoMin: null,
    activo: true,
    disponible: true,
    idCategoria,
    variantes: Array.from({ length: variantes }, (_, i) => ({
      id: id * 10 + i,
      nombre: `Variante ${i + 1}`,
      precioCentavos: 12900,
      descripcion: null,
      activo: true,
      disponible: true,
    })),
    extrasPermitidos: [],
    ingredientesRemovibles: [],
  };
}

// Se valida con el contrato real para que el menú de prueba no se aleje de lo que manda la API.
const menu = RespuestaMenuSchema.parse({
  categorias: [
    {
      id: 1,
      nombre: 'Hamburguesas',
      descripcion: null,
      activo: true,
      platillos: [platillo(1, 'Hamburguesa de Pollo', 1, 2), platillo(2, 'Hamburguesa Clásica', 1)],
    },
    {
      id: 2,
      nombre: 'Entradas',
      descripcion: null,
      activo: true,
      platillos: [platillo(3, 'Champiñón al Ajillo', 2), platillo(4, 'Nachos', 2, 3)],
    },
  ],
  extras: [
    {
      id: 1,
      nombre: 'Aguacate',
      precioCentavos: 3500,
      descripcion: null,
      activo: true,
      disponible: true,
    },
    {
      id: 2,
      nombre: 'Totopos',
      precioCentavos: 2500,
      descripcion: null,
      activo: true,
      disponible: false,
    },
  ],
  timestamp: '2026-10-06T18:05:00Z',
});

const nombres = (resultado: ReturnType<typeof filtrarMenu>) =>
  resultado.categorias.flatMap((c) => c.platillos.map((p) => p.nombre));

describe('formatearPesos', () => {
  it.each([
    [12900, '$129.00'],
    [0, '$0.00'],
    [104900, '$1,049.00'],
    [5, '$0.05'],
    [123456789, '$1,234,567.89'],
  ])('%i centavos -> %s', (centavos, esperado) => {
    expect(formatearPesos(centavos)).toBe(esperado);
  });

  it('no mete espacios (ni normales ni NBSP) que dependan del locale', () => {
    expect(formatearPesos(104900)).not.toMatch(/\s/);
  });

  // Los mismos casos que rechaza formatearPesos de la API (apps/api/src/lib/pesos.ts).
  it.each([
    ['un negativo', -5],
    ['un decimal', 403.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['un entero fuera del rango seguro', Number.MAX_SAFE_INTEGER + 1],
  ])('lanza un error con %s', (_caso, centavos) => {
    expect(() => formatearPesos(centavos)).toThrow('Monto inválido en centavos');
  });
});

describe('normalizarTexto', () => {
  it('quita acentos, ñ y diéresis, pasa a minúsculas y compacta espacios', () => {
    expect(normalizarTexto('  Champiñón   AL  Ajillo ')).toBe('champinon al ajillo');
    expect(normalizarTexto('Pingüino Ácido')).toBe('pinguino acido');
  });

  it('borra los signos de puntuación sin dejar espacio', () => {
    expect(normalizarTexto('T-Bone 450 gr.')).toBe('tbone 450 gr');
  });
});

describe('coincideNombre', () => {
  it('exige todas las palabras, en cualquier orden', () => {
    expect(coincideNombre('Hamburguesa de Pollo', 'hamburguesa pollo')).toBe(true);
    expect(coincideNombre('Hamburguesa de Pollo', 'pollo HAMBURGUESA')).toBe(true);
    expect(coincideNombre('Hamburguesa Clásica', 'hamburguesa pollo')).toBe(false);
  });

  it('una búsqueda vacía o de espacios encuentra todo', () => {
    expect(coincideNombre('Nachos', '')).toBe(true);
    expect(coincideNombre('Nachos', '   ')).toBe(true);
  });

  it('"tbone", "t-bone" y "t bone" encuentran "T-Bone 450 gr"', () => {
    for (const busqueda of ['tbone', 't-bone', 't bone']) {
      expect(coincideNombre('T-Bone 450 gr', busqueda)).toBe(true);
    }
  });

  it('ignora una "s" final en las palabras de la búsqueda', () => {
    expect(coincideNombre('Hamburguesa de Pollo', 'hamburguesas')).toBe(true);
    expect(coincideNombre('Papa con Elote', 'papas')).toBe(true);
  });

  it('no recorta la "s" final en palabras de 3 letras o menos', () => {
    // Recortada, "los" quedaría en "lo" y encontraría "Lomo".
    expect(coincideNombre('Lomo de Res', 'los')).toBe(false);
  });

  it('"zzz" no encuentra nada', () => {
    for (const nombre of ['T-Bone 450 gr', 'Hamburguesa de Pollo', 'Papa con Elote']) {
      expect(coincideNombre(nombre, 'zzz')).toBe(false);
    }
  });
});

describe('filtrarMenu', () => {
  it('sin búsqueda ni categoría devuelve todo', () => {
    const resultado = filtrarMenu(menu, { busqueda: '', idCategoria: null });
    expect(nombres(resultado)).toHaveLength(4);
    expect(resultado.extras).toHaveLength(2);
  });

  it('"hamburguesa pollo" encuentra "Hamburguesa de Pollo"', () => {
    expect(
      nombres(filtrarMenu(menu, { busqueda: 'hamburguesa pollo', idCategoria: null })),
    ).toEqual(['Hamburguesa de Pollo']);
  });

  it('"champinon" encuentra "Champiñón al Ajillo" sin importar acentos ni mayúsculas', () => {
    for (const busqueda of ['champinon', 'CHAMPIÑÓN', 'Champinón']) {
      expect(nombres(filtrarMenu(menu, { busqueda, idCategoria: null }))).toEqual([
        'Champiñón al Ajillo',
      ]);
    }
  });

  it('oculta las categorías que quedan sin platillos', () => {
    const resultado = filtrarMenu(menu, { busqueda: 'nachos', idCategoria: null });
    expect(resultado.categorias.map((c) => c.nombre)).toEqual(['Entradas']);
  });

  it('filtra por categoría y oculta los extras sueltos', () => {
    const resultado = filtrarMenu(menu, { busqueda: '', idCategoria: 2 });
    expect(resultado.categorias.map((c) => c.id)).toEqual([2]);
    expect(nombres(resultado)).toEqual(['Champiñón al Ajillo', 'Nachos']);
    expect(resultado.extras).toEqual([]);
  });

  it('combina categoría y búsqueda', () => {
    expect(nombres(filtrarMenu(menu, { busqueda: 'hamburguesa', idCategoria: 2 }))).toEqual([]);
  });

  it('la búsqueda también filtra los extras sueltos', () => {
    const resultado = filtrarMenu(menu, { busqueda: 'aguacate', idCategoria: null });
    expect(resultado.categorias).toEqual([]);
    expect(resultado.extras.map((e) => e.nombre)).toEqual(['Aguacate']);
  });

  it('conserva lo agotado: un extra con disponible false sigue en la lista (D20)', () => {
    const resultado = filtrarMenu(menu, { busqueda: 'totopos', idCategoria: null });
    expect(resultado.extras).toEqual([
      expect.objectContaining({ nombre: 'Totopos', disponible: false }),
    ]);
  });

  it('sin coincidencias no deja categorías ni extras', () => {
    expect(filtrarMenu(menu, { busqueda: 'sushi', idCategoria: null })).toEqual({
      categorias: [],
      extras: [],
    });
  });

  it('no modifica el menú original', () => {
    filtrarMenu(menu, { busqueda: 'nachos', idCategoria: 2 });
    expect(menu.categorias[0]?.platillos).toHaveLength(2);
  });
});

describe('resumirMenu', () => {
  it('cuenta categorías, platillos, variantes y extras sueltos', () => {
    expect(resumirMenu(menu)).toEqual({
      categorias: 2,
      platillos: 4,
      variantes: 7,
      extrasSueltos: 2,
    });
  });

  it('también resume un menú filtrado', () => {
    expect(resumirMenu(filtrarMenu(menu, { busqueda: 'nachos', idCategoria: null }))).toEqual({
      categorias: 1,
      platillos: 1,
      variantes: 3,
      extrasSueltos: 0,
    });
  });
});

describe('formatearHora', () => {
  it('usa la zona que se le pasa, en formato de 24 h', () => {
    expect(formatearHora('2026-10-06T18:05:00Z', 'UTC')).toBe('18:05');
    expect(formatearHora('2026-10-06T18:05:00Z', 'America/Mexico_City')).toBe('12:05');
  });
});
