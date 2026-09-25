import type { Rol } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  destinoTrasLogin,
  PANTALLAS_EMPLEADO,
  pantallaInicial,
  puedeVer,
} from '../src/auth/permisos';

const rolesDe = (path: string): readonly Rol[] =>
  PANTALLAS_EMPLEADO.find((p) => p.path === path)?.roles ?? [];

describe('puedeVer', () => {
  it.each([
    ['cocina', '/cocina', true],
    ['cocina', '/caja', false],
    ['cocina', '/admin', false],
    ['caja', '/caja', true],
    ['caja', '/cocina', false],
    ['caja', '/admin', false],
    ['admin', '/cocina', true],
    ['admin', '/caja', true],
    ['admin', '/admin', true],
  ] as const)('%s en %s → %s', (rol, path, esperado) => {
    expect(puedeVer(rol, rolesDe(path))).toBe(esperado);
  });
});

describe('pantallaInicial', () => {
  it('lleva a cada rol a su pantalla', () => {
    expect(pantallaInicial('cocina')).toBe('/cocina');
    expect(pantallaInicial('caja')).toBe('/caja');
    expect(pantallaInicial('admin')).toBe('/admin');
  });
});

describe('destinoTrasLogin', () => {
  it('regresa a la pantalla que intentaba abrir si tiene permiso', () => {
    expect(destinoTrasLogin('admin', '/cocina')).toBe('/cocina');
    expect(destinoTrasLogin('caja', '/caja')).toBe('/caja');
  });

  it('sin permiso, o sin pantalla previa, va a la de su rol', () => {
    expect(destinoTrasLogin('cocina', '/admin')).toBe('/cocina');
    expect(destinoTrasLogin('caja', undefined)).toBe('/caja');
  });

  it('ignora rutas que no son pantallas de empleado', () => {
    expect(destinoTrasLogin('admin', 'https://otro-sitio.com')).toBe('/admin');
    expect(destinoTrasLogin('cocina', '/pedir')).toBe('/cocina');
  });
});
