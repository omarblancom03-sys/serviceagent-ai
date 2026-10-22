import {
  ConfiguracionRestauranteSchema,
  ErrorConfiguracionSchema,
  type Rol,
} from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import { firmarToken } from '../src/lib/auth';
import type { Bindings } from '../src/lib/env';
import { crearRepoConfiguracionEnMemoria } from './configuracionEnMemoria';

const env = { JWT_SECRET: 'secreto-de-prueba-de-al-menos-32-caracteres' } as Bindings;
const ADMIN = '00000000-0000-4000-8000-000000000003';

async function pedir(
  rol: Rol | null,
  init: { method?: string; body?: unknown } = {},
  aplicacion = crearApp({ crearRepoConfiguracion: () => crearRepoConfiguracionEnMemoria() }),
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (rol) {
    const { token } = await firmarToken({ sub: ADMIN, rol }, env.JWT_SECRET, 3600);
    headers.Authorization = `Bearer ${token}`;
  }
  return aplicacion.request(
    '/admin/configuracion',
    {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    },
    env,
  );
}

describe('GET /admin/configuracion (US-22)', () => {
  it('con rol admin devuelve el modo de pago vigente', async () => {
    const res = await pedir('admin');
    expect(res.status).toBe(200);
    expect(ConfiguracionRestauranteSchema.parse(await res.json())).toMatchObject({
      modoPago: 'al_recoger',
      actualizadoPor: null,
    });
  });

  it.each(['cocina', 'caja'] as const)('con rol %s responde 403', async (rol) => {
    const res = await pedir(rol);
    expect(res.status).toBe(403);
    expect(ErrorConfiguracionSchema.parse(await res.json()).error).toMatch(/permiso/i);
  });

  it('sin sesión responde 401', async () => {
    expect((await pedir(null)).status).toBe(401);
  });
});

describe('PATCH /admin/configuracion (US-22)', () => {
  it('cambia el modo a nombre del empleado de la sesión', async () => {
    const repo = crearRepoConfiguracionEnMemoria({ [ADMIN]: 'Admin de prueba' });
    const app = crearApp({ crearRepoConfiguracion: () => repo });
    const res = await pedir('admin', { method: 'PATCH', body: { modoPago: 'transferencia' } }, app);
    expect(res.status).toBe(200);
    expect(ConfiguracionRestauranteSchema.parse(await res.json())).toEqual({
      modoPago: 'transferencia',
      actualizadoEn: '2026-10-21T18:00:00.000Z',
      actualizadoPor: 'Admin de prueba',
    });
    expect(repo.historial).toEqual([{ modoPago: 'transferencia', idEmpleado: ADMIN }]);
  });

  it.each([
    ['un modo desconocido', { modoPago: 'cheque' }],
    ['sin modo', {}],
    [
      'una llave de más (no se acepta quién lo cambia desde el cuerpo)',
      { modoPago: 'al_recoger', idEmpleado: 'x' },
    ],
  ])('con %s responde 400 sin cambiar nada', async (_caso, body) => {
    const repo = crearRepoConfiguracionEnMemoria();
    const app = crearApp({ crearRepoConfiguracion: () => repo });
    const res = await pedir('admin', { method: 'PATCH', body }, app);
    expect(res.status).toBe(400);
    expect(ErrorConfiguracionSchema.parse(await res.json()).error).toBe(
      'El modo de pago debe ser "al_recoger" o "transferencia".',
    );
    expect(repo.historial).toEqual([]);
  });

  it('con rol caja responde 403 y no cambia nada', async () => {
    const repo = crearRepoConfiguracionEnMemoria();
    const app = crearApp({ crearRepoConfiguracion: () => repo });
    const res = await pedir('caja', { method: 'PATCH', body: { modoPago: 'transferencia' } }, app);
    expect(res.status).toBe(403);
    expect(repo.modoPago).toBe('al_recoger');
  });

  it('sin sesión responde 401, aunque el cuerpo sea válido', async () => {
    const res = await pedir(null, { method: 'PATCH', body: { modoPago: 'transferencia' } });
    expect(res.status).toBe(401);
  });

  it('si falla al guardar responde 500 con un mensaje en español', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = crearApp({
      crearRepoConfiguracion: () => ({
        leer: () => Promise.reject(new Error('Supabase no responde')),
        cambiarModoPago: () => Promise.reject(new Error('Supabase no responde')),
      }),
    });
    const res = await pedir('admin', { method: 'PATCH', body: { modoPago: 'transferencia' } }, app);
    expect(res.status).toBe(500);
    expect(ErrorConfiguracionSchema.parse(await res.json()).error).toBe(
      'No se pudo cambiar el modo de pago. Intenta de nuevo en un momento.',
    );
    const lectura = await pedir('admin', {}, app);
    expect(lectura.status).toBe(500);
  });

  it('aparece en el OpenAPI con el esquema Bearer', async () => {
    const doc = (await (await crearApp().request('/openapi.json')).json()) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    const ruta = doc.paths['/admin/configuracion'];
    expect(ruta?.get?.security).toEqual([{ Bearer: [] }]);
    expect(ruta?.patch?.security).toEqual([{ Bearer: [] }]);
  });
});
