import { EmpleadoPublicoSchema, SesionActualSchema, SesionSchema } from '@serviceagent/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/index';
import type { EmpleadoConPin } from '../src/services/sesion';
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
let empleados: Map<string, EmpleadoConPin>;
beforeEach(async () => {
  const enMemoria = await crearRepoEnMemoria();
  empleados = enMemoria.empleados;
  app = crearApp({ crearRepoEmpleados: () => enMemoria.repo });
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

  const tokenDe = async (empleadoId: string, pin: string) =>
    SesionSchema.parse(await (await login(empleadoId, pin)).json()).token;
  const sesionCon = (token: string) =>
    app.request('/auth/sesion', { headers: { Authorization: `Bearer ${token}` } }, env);
  const modificar = (id: string, cambios: Partial<EmpleadoConPin>) => {
    const empleado = empleados.get(id);
    if (!empleado) throw new Error(`No existe el empleado ${id}`);
    empleados.set(id, { ...empleado, ...cambios });
  };

  it('empleado activo: 200 con su nombre desde la base y la expiración del token', async () => {
    const { token, expiraEn } = SesionSchema.parse(await (await login(IDS.caja, '2222')).json());
    const exp = Date.parse(expiraEn) / 1000;

    const res = await sesionCon(token);

    expect(res.status).toBe(200);
    const cuerpo = await res.json();
    expect(SesionActualSchema.strict().parse(cuerpo)).toEqual({
      empleado: { id: IDS.caja, nombre: 'Caja de prueba', rol: 'caja' },
      exp,
    });
    expect(JSON.stringify(cuerpo)).not.toContain('pbkdf2');
  });

  it('devuelve el nombre actual de la base, no uno guardado en el token', async () => {
    const token = await tokenDe(IDS.caja, '2222');
    modificar(IDS.caja, { nombre: 'Caja renombrada' });

    const cuerpo = SesionActualSchema.parse(await (await sesionCon(token)).json());
    expect(cuerpo.empleado.nombre).toBe('Caja renombrada');
  });

  it('empleado desactivado después de entrar: 401 aunque el token siga vigente', async () => {
    const token = await tokenDe(IDS.caja, '2222');
    modificar(IDS.caja, { activo: false });

    const res = await sesionCon(token);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'Sesión inválida o vencida. Vuelve a iniciar sesión.',
    });
  });

  it('empleado que ya no existe: 401', async () => {
    const token = await tokenDe(IDS.caja, '2222');
    empleados.delete(IDS.caja);

    expect((await sesionCon(token)).status).toBe(401);
  });

  it('empleado al que le cambiaron el rol: 401 (el token dice otro rol)', async () => {
    const token = await tokenDe(IDS.caja, '2222');
    modificar(IDS.caja, { rol: 'admin' });

    expect((await sesionCon(token)).status).toBe(401);
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
