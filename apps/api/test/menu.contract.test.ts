import {
  CategoriaSchema,
  ParamsProductoSchema,
  PlatilloSchema,
  RespuestaMenuSchema,
  RespuestaProductoDetalleSchema,
  VarianteSchema,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

const variante = {
  id: 1,
  nombre: 'Único',
  precioCentavos: 12300,
  descripcion: null,
  activo: true,
  disponible: true,
};

const platillo = {
  id: 1,
  nombre: 'Guacamole',
  descripcion: 'Aguacate con pico de gallo.',
  imagen: null,
  tiempoEstimadoMin: 15,
  activo: true,
  disponible: true,
  idCategoria: 1,
  variantes: [variante],
  extrasPermitidos: [],
  ingredientesRemovibles: [{ id: 1, nombre: 'Cebolla' }],
};

describe('Contrato del menú', () => {
  it('acepta una categoría válida', () => {
    const categoria = CategoriaSchema.parse({
      id: 1,
      nombre: 'De entradas al rancho',
      descripcion: null,
      activo: true,
    });
    expect(categoria.nombre).toBe('De entradas al rancho');
  });

  it('acepta una variante con precio en centavos', () => {
    expect(VarianteSchema.parse(variante).precioCentavos).toBe(12300);
  });

  it.each([123.45, -100])('rechaza el precio %s (debe ser entero y no negativo)', (precio) => {
    expect(() => VarianteSchema.parse({ ...variante, precioCentavos: precio })).toThrow();
  });

  it('exige disponible en platillo y variante', () => {
    expect(PlatilloSchema.parse(platillo).disponible).toBe(true);
    expect(() => PlatilloSchema.parse({ ...platillo, disponible: undefined })).toThrow();
    expect(() => VarianteSchema.parse({ ...variante, disponible: undefined })).toThrow();
    expect(() => VarianteSchema.parse({ ...variante, disponible: null })).toThrow();
  });

  it('rechaza un platillo sin variantes (el precio vive en la variante)', () => {
    expect(() => PlatilloSchema.parse({ ...platillo, variantes: [] })).toThrow();
  });

  it('acepta tiempoEstimadoMin en null (la columna lo permite) y exige ingredientesRemovibles', () => {
    const sinTiempo = PlatilloSchema.parse({ ...platillo, tiempoEstimadoMin: null });
    expect(sinTiempo.tiempoEstimadoMin).toBeNull();
    expect(() =>
      PlatilloSchema.parse({ ...platillo, ingredientesRemovibles: undefined }),
    ).toThrow();
  });

  it('exige descripcion e imagen aunque sean null (siempre vienen en la respuesta)', () => {
    expect(() => PlatilloSchema.parse({ ...platillo, imagen: undefined })).toThrow();
    expect(() => VarianteSchema.parse({ ...variante, descripcion: undefined })).toThrow();
  });

  it('acepta un corte con Espuelas en extrasPermitidos', () => {
    const corte = PlatilloSchema.parse({
      ...platillo,
      nombre: 'T-Bone 450 gr',
      extrasPermitidos: [
        { id: 5, nombre: 'Espuelas (camarones)', precioCentavos: 5500, disponible: true },
      ],
    });
    expect(corte.extrasPermitidos[0]?.precioCentavos).toBe(5500);
  });

  it('acepta el menú con categorías, platillos y extras sueltos', () => {
    const menu = RespuestaMenuSchema.parse({
      categorias: [
        {
          id: 1,
          nombre: 'De entradas al rancho',
          descripcion: null,
          activo: true,
          platillos: [platillo],
        },
      ],
      extras: [
        {
          id: 1,
          nombre: 'Totopos',
          precioCentavos: 2000,
          descripcion: null,
          activo: true,
          disponible: true,
        },
      ],
      timestamp: new Date().toISOString(),
    });
    expect(menu.categorias[0]?.platillos).toHaveLength(1);
    expect(menu.extras.length).toBeGreaterThan(0);
  });

  it('rechaza un timestamp que no es ISO 8601', () => {
    expect(() =>
      RespuestaMenuSchema.parse({ categorias: [], extras: [], timestamp: 'ayer' }),
    ).toThrow();
  });

  it('acepta el detalle de un platillo', () => {
    expect(RespuestaProductoDetalleSchema.parse({ platillo }).platillo.id).toBe(1);
  });

  it('convierte el id de la URL a número y rechaza ids inválidos', () => {
    expect(ParamsProductoSchema.parse({ id: '42' }).id).toBe(42);
    expect(ParamsProductoSchema.parse({ id: '2147483647' }).id).toBe(2_147_483_647);
    for (const id of ['0', '-1', '1.5', 'abc', '1e3', '0x10', ' 42', '2147483648', '']) {
      expect(() => ParamsProductoSchema.parse({ id })).toThrow();
    }
  });
});

describe('Documentación del menú', () => {
  it('publica GET /menu y GET /menu/productos/{id} en el OpenAPI', async () => {
    const res = await app.request('/openapi.json');

    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, { get?: { responses: Record<string, unknown> } }>;
    };
    expect(Object.keys(doc.paths['/menu']?.get?.responses ?? {})).toEqual(['200', '500']);
    expect(Object.keys(doc.paths['/menu/productos/{id}']?.get?.responses ?? {})).toEqual([
      '200',
      '400',
      '404',
      '500',
    ]);
  });
});
