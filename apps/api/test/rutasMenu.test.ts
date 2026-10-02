import {
  ErrorMenuSchema,
  RespuestaMenuSchema,
  RespuestaProductoDetalleSchema,
  type Platillo,
  type RespuestaMenu,
} from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import { crearRepoMenuEnMemoria, repoMenuQueFalla } from './menuEnMemoria';

const app = crearApp({ crearRepoMenu: () => crearRepoMenuEnMemoria() });
const appQueFalla = crearApp({ crearRepoMenu: () => repoMenuQueFalla });

async function leerMenu(): Promise<RespuestaMenu> {
  const res = await app.request('/menu');
  expect(res.status).toBe(200);
  return RespuestaMenuSchema.parse(await res.json());
}

const platillos = (menu: RespuestaMenu): Platillo[] => menu.categorias.flatMap((c) => c.platillos);
const buscar = (menu: RespuestaMenu, nombre: string) =>
  platillos(menu).find((p) => p.nombre === nombre);

describe('GET /menu', () => {
  it('devuelve categorías con platillos, variantes, extras y disponibilidad según el contrato', async () => {
    const menu = await leerMenu();

    expect(menu.categorias.map((c) => c.nombre)).toEqual(['De entradas al rancho', 'Cortes']);
    expect(
      platillos(menu).every((p) => p.disponible && p.variantes.every((v) => v.disponible)),
    ).toBe(true);
  });

  it('ordena categorías, platillos y variantes por id', async () => {
    const menu = await leerMenu();

    expect(menu.categorias.map((c) => c.id)).toEqual([1, 2]);
    expect(menu.categorias[0]?.platillos.map((p) => p.id)).toEqual([1, 3]);
    expect(menu.categorias[1]?.platillos.map((p) => p.id)).toEqual([2, 7]);
  });

  it('oculta lo inactivo, platillos sin variantes activas y categorías vacías o inactivas', async () => {
    const menu = await leerMenu();
    const nombres = platillos(menu).map((p) => p.nombre);

    expect(nombres).not.toContain('Platillo dado de baja');
    expect(nombres).not.toContain('Sin variantes activas');
    expect(nombres).not.toContain('Ponche');
    expect(menu.categorias.map((c) => c.nombre)).not.toContain('Categoría vacía');
    expect(buscar(menu, 'Queso fundido')?.variantes.map((v) => v.nombre)).toEqual(['Natural']);
  });

  it('pone Espuelas solo en los cortes ligados y sin extras inactivos', async () => {
    const menu = await leerMenu();
    const espuelas = [
      { id: 5, nombre: 'Espuelas (camarones)', precioCentavos: 5500, disponible: true },
    ];

    expect(buscar(menu, 'T-Bone 450 gr')?.extrasPermitidos).toEqual(espuelas);
    expect(buscar(menu, 'Arrachera 450 gr')?.extrasPermitidos).toEqual(espuelas);
    expect(buscar(menu, 'Guacamole')?.extrasPermitidos).toEqual([]);
  });

  it('lista como sueltos solo los extras activos que no están ligados a ningún platillo', async () => {
    const menu = await leerMenu();

    expect(menu.extras).toEqual([
      {
        id: 1,
        nombre: 'Totopos',
        precioCentavos: 2000,
        descripcion: 'Porción extra.',
        activo: true,
        disponible: true,
      },
    ]);
  });

  it('incluye los ingredientes removibles activos y acepta tiempoEstimadoMin en null', async () => {
    const menu = await leerMenu();

    expect(buscar(menu, 'Guacamole')?.ingredientesRemovibles).toEqual([
      { id: 1, nombre: 'Cebolla' },
    ]);
    expect(buscar(menu, 'Queso fundido')?.tiempoEstimadoMin).toBeNull();
  });

  it('responde 500 con { error } si no se puede leer la base', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await appQueFalla.request('/menu');

    expect(res.status).toBe(500);
    expect(ErrorMenuSchema.parse(await res.json()).error).toMatch(/menú/);
  });
});

describe('GET /menu/productos/{id}', () => {
  it('devuelve el platillo igual que en el menú', async () => {
    const res = await app.request('/menu/productos/2');

    expect(res.status).toBe(200);
    const { platillo } = RespuestaProductoDetalleSchema.parse(await res.json());
    const menu = await leerMenu();
    expect(platillo).toEqual(buscar(menu, 'T-Bone 450 gr'));
    expect(platillo.variantes[0]?.precioCentavos).toBe(45000);
  });

  it.each([
    ['no existe', '999'],
    ['está inactivo', '4'],
    ['su categoría está inactiva', '6'],
    ['no tiene variantes activas', '5'],
  ])('responde 404 si el platillo %s', async (_, id) => {
    const res = await app.request(`/menu/productos/${id}`);

    expect(res.status).toBe(404);
    expect(ErrorMenuSchema.parse(await res.json()).error).toBeTruthy();
  });

  it.each(['abc', '0', '-1', '1.5', '1e3', '0x10', '2147483648', '99999999999'])(
    'responde 400 con { error } para el id %s',
    async (id) => {
      const res = await app.request(`/menu/productos/${id}`);

      expect(res.status).toBe(400);
      expect(ErrorMenuSchema.parse(await res.json()).error).toMatch(/entero positivo/);
    },
  );

  it('responde 500 con { error } si no se puede leer la base', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await appQueFalla.request('/menu/productos/1');

    expect(res.status).toBe(500);
    expect(ErrorMenuSchema.parse(await res.json()).error).toMatch(/menú/);
  });
});
