import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';
import {
  duracionEnSegundos,
  firmarToken,
  leerSecreto,
  requiereRol,
  verificarToken,
} from '../src/lib/auth';
import type { AppEnv } from '../src/lib/env';
import { IDS } from './repoEnMemoria';

const SECRETO = 'secreto-de-prueba-con-al-menos-32-caracteres';
const OCHO_HORAS = 8 * 3600;

function decodificarPayload(token: string): Record<string, unknown> {
  const [, payload = ''] = token.split('.');
  return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
}

describe('firmarToken', () => {
  it('el payload lleva exactamente sub, rol y exp', async () => {
    const ahora = Date.UTC(2026, 8, 25, 12, 0, 0);
    const { token, exp } = await firmarToken(
      { sub: IDS.caja, rol: 'caja' },
      SECRETO,
      OCHO_HORAS,
      ahora,
    );

    const payload = decodificarPayload(token);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'rol', 'sub']);
    expect(payload).toEqual({ sub: IDS.caja, rol: 'caja', exp });
    expect(exp).toBe(ahora / 1000 + OCHO_HORAS);
  });

  it('se niega a firmar con un secreto corto o vacío', async () => {
    await expect(firmarToken({ sub: IDS.caja, rol: 'caja' }, 'corto', OCHO_HORAS)).rejects.toThrow(
      /JWT_SECRET/,
    );
    expect(() => leerSecreto(undefined)).toThrow(/openssl rand -base64 32/);
  });
});

describe('verificarToken', () => {
  it('devuelve el payload de un token válido', async () => {
    const { token, exp } = await firmarToken({ sub: IDS.admin, rol: 'admin' }, SECRETO, OCHO_HORAS);
    expect(await verificarToken(token, SECRETO)).toEqual({ sub: IDS.admin, rol: 'admin', exp });
  });

  it('rechaza un token vencido', async () => {
    const hace9Horas = Date.now() - 9 * 3600 * 1000;
    const { token } = await firmarToken(
      { sub: IDS.caja, rol: 'caja' },
      SECRETO,
      OCHO_HORAS,
      hace9Horas,
    );
    expect(await verificarToken(token, SECRETO)).toBeNull();
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const { token } = await firmarToken(
      { sub: IDS.caja, rol: 'caja' },
      `${SECRETO}-otro`,
      OCHO_HORAS,
    );
    expect(await verificarToken(token, SECRETO)).toBeNull();
  });

  it('rechaza un token alterado (rol cambiado a mano)', async () => {
    const { token } = await firmarToken({ sub: IDS.cocina, rol: 'cocina' }, SECRETO, OCHO_HORAS);
    const [cabecera, payload, firma] = token.split('.');
    const alterado = btoa(atob(payload ?? '').replace('"cocina"', '"admin"')).replace(/=+$/, '');
    expect(await verificarToken(`${cabecera}.${alterado}.${firma}`, SECRETO)).toBeNull();
  });

  it('rechaza un token sin firma (alg "none")', async () => {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: IDS.admin, rol: 'admin', exp })}.`;
    expect(await verificarToken(token, SECRETO)).toBeNull();
  });

  it('rechaza un token con campos extra o con un rol que no existe', async () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const conExtra = await sign({ sub: IDS.caja, rol: 'caja', exp, nombre: 'X' }, SECRETO, 'HS256');
    const rolFalso = await sign({ sub: IDS.caja, rol: 'gerente', exp }, SECRETO, 'HS256');

    expect(await verificarToken(conExtra, SECRETO)).toBeNull();
    expect(await verificarToken(rolFalso, SECRETO)).toBeNull();
  });
});

describe('duracionEnSegundos', () => {
  it.each([
    ['8h', 28_800],
    ['30m', 1_800],
    ['900s', 900],
  ])('%s → %i segundos', (texto, segundos) => {
    expect(duracionEnSegundos(texto)).toBe(segundos);
  });

  it('usa 8 horas por defecto y rechaza formatos inválidos', () => {
    expect(duracionEnSegundos()).toBe(OCHO_HORAS);
    expect(() => duracionEnSegundos('8 horas')).toThrow(/JWT_EXPIRES_IN/);
    expect(() => duracionEnSegundos('0h')).toThrow(/JWT_EXPIRES_IN/);
  });
});

describe('requiereRol', () => {
  const app = new Hono<AppEnv>();
  app.get('/solo-admin', requiereRol('admin'), (c) => c.json({ ok: true }));
  app.get('/cocina', requiereRol('cocina'), (c) => c.json({ sub: c.get('sesion').sub }));

  const env = {
    JWT_SECRET: SECRETO,
    PIN_PEPPER: '',
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  };
  const pedir = async (ruta: string, token?: string) =>
    app.request(ruta, token ? { headers: { Authorization: `Bearer ${token}` } } : {}, env);
  const tokenDe = async (rol: 'cocina' | 'caja' | 'admin') =>
    (await firmarToken({ sub: IDS[rol], rol }, SECRETO, OCHO_HORAS)).token;

  it('responde 401 sin token o con un token inválido', async () => {
    expect((await pedir('/cocina')).status).toBe(401);
    expect((await pedir('/cocina', 'no-es-un-jwt')).status).toBe(401);
  });

  it('responde 403 si el rol no está permitido (cocina no entra a rutas de admin)', async () => {
    const res = await pedir('/solo-admin', await tokenDe('cocina'));
    expect(res.status).toBe(403);
    expect((await pedir('/cocina', await tokenDe('caja'))).status).toBe(403);
  });

  it('deja pasar al rol permitido y guarda la sesión en el contexto', async () => {
    const res = await pedir('/cocina', await tokenDe('cocina'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sub: IDS.cocina });
  });

  it('admin entra a todo', async () => {
    const token = await tokenDe('admin');
    expect((await pedir('/solo-admin', token)).status).toBe(200);
    expect((await pedir('/cocina', token)).status).toBe(200);
  });
});
