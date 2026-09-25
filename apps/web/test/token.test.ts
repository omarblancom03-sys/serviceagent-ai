import type { EmpleadoPublico } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  crearSesion,
  leerPayload,
  leerSesionGuardada,
  serializarSesion,
  tokenVencido,
} from '../src/auth/token';

const AHORA = Date.parse('2026-09-25T12:00:00Z');
const EN_8_HORAS = AHORA / 1000 + 8 * 3600;

const CAJA: EmpleadoPublico = {
  id: '77b9bf63-5f4a-4509-823d-3a7de04edb82',
  nombre: 'Caja de prueba',
  rol: 'caja',
};

const base64url = (texto: string) =>
  btoa(texto).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** JWT con el payload dado. La firma es falsa: la web nunca la verifica (lo hace la API). */
const jwt = (payload: unknown) =>
  [base64url('{"alg":"HS256","typ":"JWT"}'), base64url(JSON.stringify(payload)), 'firma'].join('.');

const tokenCaja = (exp = EN_8_HORAS) => jwt({ sub: CAJA.id, rol: 'caja', exp });

describe('leerPayload', () => {
  it('lee sub, rol y exp de un token válido', () => {
    expect(leerPayload(tokenCaja())).toEqual({ sub: CAJA.id, rol: 'caja', exp: EN_8_HORAS });
  });

  it.each([
    ['texto que no es JWT', 'hola'],
    ['payload que no es base64', 'a.%%%.b'],
    ['payload que no es JSON', `a.${base64url('no json')}.b`],
    ['rol desconocido', jwt({ sub: CAJA.id, rol: 'gerente', exp: EN_8_HORAS })],
    ['campos extra (el esquema es estricto)', jwt({ sub: CAJA.id, rol: 'caja', exp: 1, x: 1 })],
  ])('devuelve null con %s', (_caso, token) => {
    expect(leerPayload(token)).toBeNull();
  });
});

describe('tokenVencido', () => {
  it('no está vencido antes de exp y sí a partir de exp', () => {
    const payload = { sub: CAJA.id, rol: 'caja' as const, exp: EN_8_HORAS };
    expect(tokenVencido(payload, AHORA)).toBe(false);
    expect(tokenVencido(payload, EN_8_HORAS * 1000)).toBe(true);
  });
});

describe('crearSesion', () => {
  it('arma la sesión si el token corresponde al empleado', () => {
    expect(crearSesion(tokenCaja(), CAJA, AHORA)).toMatchObject({
      empleado: CAJA,
      payload: { rol: 'caja' },
    });
  });

  it('rechaza un token vencido', () => {
    expect(crearSesion(tokenCaja(AHORA / 1000 - 1), CAJA, AHORA)).toBeNull();
  });

  it('rechaza un token de otro empleado o con otro rol', () => {
    expect(crearSesion(tokenCaja(), { ...CAJA, id: crypto.randomUUID() }, AHORA)).toBeNull();
    expect(crearSesion(tokenCaja(), { ...CAJA, rol: 'admin' }, AHORA)).toBeNull();
  });
});

describe('leerSesionGuardada', () => {
  it('recupera lo que guardó serializarSesion', () => {
    const sesion = crearSesion(tokenCaja(), CAJA, AHORA);
    expect(sesion).not.toBeNull();
    expect(leerSesionGuardada(serializarSesion(sesion!), AHORA)).toEqual(sesion);
  });

  it('descarta la sesión cuando el token ya venció (al cargar la app)', () => {
    const guardada = JSON.stringify({ token: tokenCaja(), empleado: CAJA });
    expect(leerSesionGuardada(guardada, EN_8_HORAS * 1000 + 1)).toBeNull();
  });

  it.each([
    ['nada guardado', null],
    ['texto dañado', '{no es json'],
    ['sin token', JSON.stringify({ empleado: CAJA })],
    ['empleado inválido', JSON.stringify({ token: 'x.y.z', empleado: { id: 'no-uuid' } })],
  ])('devuelve null con %s', (_caso, texto) => {
    expect(leerSesionGuardada(texto, AHORA)).toBeNull();
  });
});
