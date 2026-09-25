import { EmpleadoPublicoSchema, SesionSchema, TokenPayloadSchema } from '@serviceagent/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/index';
import { crearRepoEnMemoria, IDS, PEPPER_TEST } from './repoEnMemoria';

const env = {
  JWT_SECRET: 'secreto-de-prueba-con-al-menos-32-caracteres',
  JWT_EXPIRES_IN: '8h',
  PIN_PEPPER: PEPPER_TEST,
  SUPABASE_URL: 'http://no-se-usa-en-tests',
  SUPABASE_SERVICE_ROLE_KEY: 'no-se-usa-en-tests',
  CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
};

let app: ReturnType<typeof crearApp>;
beforeEach(async () => {
  const { repo } = await crearRepoEnMemoria();
  app = crearApp({ crearRepoEmpleados: () => repo });
});

const login = (empleadoId: string, pin: string) =>
  app.request(
    '/auth/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empleadoId, pin }),
    },
    env,
  );

describe('GET /auth/empleados', () => {
  it('lista empleados activos solo con id, nombre y rol', async () => {
    const res = await app.request('/auth/empleados', {}, env);

    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as unknown[];
    expect(cuerpo).toHaveLength(3);
    for (const empleado of cuerpo) {
      expect(Object.keys(EmpleadoPublicoSchema.parse(empleado)).sort()).toEqual([
        'id',
        'nombre',
        'rol',
      ]);
      expect(JSON.stringify(empleado)).not.toContain('pbkdf2');
    }
  });
});

describe('POST /auth/login', () => {
  it('con el PIN correcto devuelve token, expiración y empleado', async () => {
    const res = await login(IDS.cocina, '1111');

    expect(res.status).toBe(200);
    const sesion = SesionSchema.parse(await res.json());
    expect(sesion.empleado).toEqual({ id: IDS.cocina, nombre: 'Cocina de prueba', rol: 'cocina' });
    const horas = (Date.parse(sesion.expiraEn) - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(7.9);
    expect(horas).toBeLessThanOrEqual(8);
  });

  it('con PIN incorrecto responde 401 e indica los intentos restantes', async () => {
    const res = await login(IDS.cocina, '9999');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'PIN incorrecto.', intentosRestantes: 4 });
  });

  it('al 5.º intento fallido responde 423 y sigue bloqueado con el PIN correcto', async () => {
    for (let i = 0; i < 4; i++) await login(IDS.cocina, '9999');

    const bloqueo = await login(IDS.cocina, '9999');
    expect(bloqueo.status).toBe(423);
    expect(await bloqueo.json()).toMatchObject({ minutosRestantes: 15 });
    expect((await login(IDS.cocina, '1111')).status).toBe(423);
  });

  it('rechaza con 400 un PIN que no tiene 4 dígitos o un id que no es UUID', async () => {
    expect((await login(IDS.cocina, '123')).status).toBe(400);
    expect((await login(IDS.cocina, '12a4')).status).toBe(400);
    expect((await login('no-es-uuid', '1111')).status).toBe(400);
  });

  it.each([
    ['JWT_SECRET', { JWT_SECRET: '' }],
    ['PIN_PEPPER', { PIN_PEPPER: '' }],
  ])('responde 500 sin tocar los intentos si falta %s', async (_variable, faltante) => {
    const res = await app.request(
      '/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empleadoId: IDS.cocina, pin: '9999' }),
      },
      { ...env, ...faltante },
    );
    expect(res.status).toBe(500);
    expect(await (await login(IDS.cocina, '9999')).json()).toMatchObject({ intentosRestantes: 4 });
  });
});

describe('GET /auth/sesion', () => {
  it('sin token responde 401', async () => {
    expect((await app.request('/auth/sesion', {}, env)).status).toBe(401);
  });

  it('con token devuelve sub, rol y exp', async () => {
    const { token } = SesionSchema.parse(await (await login(IDS.caja, '2222')).json());
    const res = await app.request(
      '/auth/sesion',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );

    expect(res.status).toBe(200);
    expect(TokenPayloadSchema.parse(await res.json())).toMatchObject({
      sub: IDS.caja,
      rol: 'caja',
    });
  });
});

describe('CORS', () => {
  it('permite los orígenes de CORS_ORIGINS y no otros', async () => {
    const desde = (origen: string) =>
      app.request('/auth/empleados', { headers: { Origin: origen } }, env);

    expect((await desde('http://localhost:5173')).headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    );
    expect(
      (await desde('https://sitio-malo.example')).headers.get('Access-Control-Allow-Origin'),
    ).toBeNull();
  });
});

describe('Documentación', () => {
  it('publica las rutas de autenticación y el esquema Bearer en el OpenAPI', async () => {
    const doc = (await (await app.request('/openapi.json', {}, env)).json()) as {
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown> };
    };

    expect(doc.paths).toHaveProperty('/auth/empleados');
    expect(doc.paths).toHaveProperty('/auth/login');
    expect(doc.paths).toHaveProperty('/auth/sesion');
    expect(doc.components.securitySchemes).toHaveProperty('Bearer');
  });
});
