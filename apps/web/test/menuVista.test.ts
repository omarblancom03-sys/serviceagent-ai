import { RespuestaMenuSchema, type Platillo } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/api';
import { filtrarMenu } from '../src/lib/menuAdmin';
import {
  MENSAJE_ERROR_CLIENTE,
  mensajeErrorMenu,
  nombreVarianteVisible,
  opcionesVista,
} from '../src/lib/menuVista';

function platillo(id: number, nombre: string, idCategoria: number): Platillo {
  return {
    id,
    nombre,
    descripcion: '',
    imagen: null,
    tiempoEstimadoMin: 15,
    activo: true,
    disponible: true,
    idCategoria,
    variantes: [
      {
        id: id * 10,
        nombre: 'Único',
        precioCentavos: 12900,
        descripcion: null,
        activo: true,
        disponible: true,
      },
    ],
    extrasPermitidos: [],
    ingredientesRemovibles: [],
  };
}

function categoria(id: number, nombre: string, platillos: Platillo[]) {
  return { id, nombre, descripcion: null, activo: true, platillos };
}

// Se valida con el contrato real para que el menú de prueba no se aleje de lo que manda la API.
const menu = RespuestaMenuSchema.parse({
  categorias: [
    categoria(1, 'Hamburguesas', [platillo(1, 'Pollo', 1), platillo(2, 'Granero', 1)]),
    categoria(2, 'Entradas', [platillo(3, 'Tiras de pollo', 2)]),
    categoria(3, 'Mariscos', [platillo(4, 'Camarones al ajo', 3)]),
    categoria(4, 'Cortes', [platillo(5, 'T-Bone 450 gr', 4)]),
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
  ],
  timestamp: '2026-10-06T18:05:00Z',
});

const nombres = (busqueda: string, buscarPorCategoria: boolean) =>
  filtrarMenu(menu, { busqueda, idCategoria: null, buscarPorCategoria }).categorias.flatMap((c) =>
    c.platillos.map((p) => p.nombre),
  );

describe('opcionesVista', () => {
  const visibilidad = [
    'mostrarResumen',
    'mostrarHora',
    'mostrarConteoFiltrado',
    'mostrarTiempoPrep',
    'mostrarLeyendaPrep',
  ] as const;

  it('cliente: oculta todos los datos internos y busca por categoría', () => {
    const opciones = opcionesVista('cliente');
    for (const bandera of visibilidad) expect(opciones[bandera]).toBe(false);
    expect(opciones.buscarPorCategoria).toBe(true);
  });

  it('admin: muestra todo y busca solo por nombre, como en US-05', () => {
    const opciones = opcionesVista('admin');
    for (const bandera of visibilidad) expect(opciones[bandera]).toBe(true);
    expect(opciones.buscarPorCategoria).toBe(false);
  });

  it('cliente: ningún texto visible deja ver datos internos ni códigos HTTP', () => {
    const opciones = opcionesVista('cliente');
    const textos = [
      opciones.subtitulo,
      opciones.etiquetaBusqueda,
      opciones.placeholderBusqueda,
      mensajeErrorMenu(new ErrorApi(503, null), opciones.errorDetallado),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/prep|cargado|mostrando|solo lectura/i);
      expect(texto).not.toMatch(/\b[1-5]\d\d\b/);
    }
  });
});

describe('filtrarMenu con buscarPorCategoria', () => {
  it('"hamburguesa" y "hamburguesas" encuentran los platillos de Hamburguesas', () => {
    for (const busqueda of ['hamburguesa', 'hamburguesas', 'HAMBURGUESA']) {
      expect(nombres(busqueda, true)).toEqual(['Pollo', 'Granero']);
    }
  });

  it('"mariscos" encuentra esa categoría', () => {
    expect(nombres('mariscos', true)).toEqual(['Camarones al ajo']);
  });

  it('"hamburguesa pollo" encuentra la hamburguesa "Pollo" y no "Tiras de pollo"', () => {
    expect(nombres('hamburguesa pollo', true)).toEqual(['Pollo']);
  });

  it('"pollo" sigue encontrando platillos de cualquier categoría por su nombre', () => {
    expect(nombres('pollo', true)).toEqual(['Pollo', 'Tiras de pollo']);
  });

  it('"tbone" sigue encontrando "T-Bone 450 gr" y "zzz" no encuentra nada', () => {
    expect(nombres('tbone', true)).toEqual(['T-Bone 450 gr']);
    expect(
      filtrarMenu(menu, { busqueda: 'zzz', idCategoria: null, buscarPorCategoria: true }),
    ).toEqual({ categorias: [], extras: [] });
  });

  it('los extras sueltos se siguen buscando por su nombre', () => {
    const filtro = { idCategoria: null, buscarPorCategoria: true };
    expect(filtrarMenu(menu, { ...filtro, busqueda: 'aguacate' }).extras).toHaveLength(1);
    expect(filtrarMenu(menu, { ...filtro, busqueda: 'hamburguesa' }).extras).toEqual([]);
  });

  it('desactivada (como en /admin), "hamburguesa" no encuentra "Pollo" ni "Granero"', () => {
    expect(nombres('hamburguesa', false)).toEqual([]);
    expect(nombres('mariscos', false)).toEqual([]);
    expect(filtrarMenu(menu, { busqueda: 'hamburguesa', idCategoria: null }).categorias).toEqual(
      [],
    );
  });
});

describe('nombreVarianteVisible', () => {
  const variante = (nombre: string) => ({ nombre });

  it('una sola variante "Único" muestra solo el precio', () => {
    expect(nombreVarianteVisible(variante('Único'), 1, true)).toBeNull();
    expect(nombreVarianteVisible(variante('Unico'), 1, true)).toBeNull();
  });

  it('varias variantes muestran su nombre', () => {
    expect(nombreVarianteVisible(variante('Chica'), 2, true)).toBe('Chica');
    expect(nombreVarianteVisible(variante('Único'), 2, true)).toBe('Único');
  });

  it('una sola variante con otro nombre lo conserva', () => {
    expect(nombreVarianteVisible(variante('Orden de 3'), 1, true)).toBe('Orden de 3');
  });

  it('sin simplificar (admin) siempre muestra el nombre', () => {
    expect(nombreVarianteVisible(variante('Único'), 1, false)).toBe('Único');
  });
});

describe('mensajeErrorMenu', () => {
  const errorZod = Object.assign(new Error('formato'), { name: 'ZodError' });
  const errores = [new ErrorApi(500, null), errorZod, new TypeError('Failed to fetch')];

  it('cliente: el mismo mensaje claro sea cual sea la causa', () => {
    for (const error of errores) {
      expect(mensajeErrorMenu(error, false)).toBe(MENSAJE_ERROR_CLIENTE);
    }
  });

  it('admin: conserva los mensajes detallados de US-05', () => {
    expect(mensajeErrorMenu(new ErrorApi(500, null), true)).toContain('(500)');
    expect(mensajeErrorMenu(errorZod, true)).toContain('formato esperado');
    expect(mensajeErrorMenu(new TypeError('Failed to fetch'), true)).toContain(
      'No se pudo conectar',
    );
  });
});
