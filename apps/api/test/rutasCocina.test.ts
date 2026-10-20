import { ErrorCocinaSchema, RespuestaPedidosCocinaSchema, type Rol } from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import { firmarToken } from '../src/lib/auth';
import type { Bindings } from '../src/lib/env';
import type { CocinaRepo, PedidoActivo } from '../src/services/cocina';

const env = { JWT_SECRET: 'secreto-de-prueba-de-al-menos-32-caracteres' } as Bindings;

const activos: PedidoActivo[] = [
  {
    folio: 1002,
    nombreCliente: 'Luis',
    estado: 'preparando',
    enColaDesde: new Date('2026-10-15T18:05:00Z'),
    renglones: [{ tipo: 'extra', cantidad: 1, nombre: 'Totopos' }],
  },
  {
    folio: 1001,
    nombreCliente: 'María José',
    estado: 'en_cola',
    enColaDesde: new Date('2026-10-15T18:00:00Z'),
    renglones: [
      {
        tipo: 'platillo',
        cantidad: 2,
        nombre: 'T-Bone 450 gr',
        variante: null,
        sinIngredientes: [],
        extras: [{ nombre: 'Espuelas (camarones)', cantidad: 1 }],
      },
    ],
  },
];

const repoCon = (pedidos: PedidoActivo[]): CocinaRepo => ({
  leerPedidosActivos: () => Promise.resolve(pedidos),
});
const app = crearApp({ crearRepoCocina: () => repoCon(activos) });

async function pedir(rol: Rol | null, aplicacion = app) {
  const headers: Record<string, string> = {};
  if (rol) {
    const { token } = await firmarToken(
      { sub: '00000000-0000-4000-8000-000000000001', rol },
      env.JWT_SECRET,
      3600,
    );
    headers.Authorization = `Bearer ${token}`;
  }
  return aplicacion.request('/cocina/pedidos', { headers }, env);
}

describe('GET /cocina/pedidos (US-10)', () => {
  it.each(['cocina', 'admin'] as const)('con rol %s devuelve los tickets en orden', async (rol) => {
    const res = await pedir(rol);
    expect(res.status).toBe(200);
    const { pedidos } = RespuestaPedidosCocinaSchema.parse(await res.json());
    expect(pedidos.map((p) => p.folioTexto)).toEqual(['#1001', '#1002']);
  });

  it('no manda precios ni teléfono', async () => {
    const texto = await (await pedir('cocina')).text();
    expect(texto).not.toMatch(/centavos|telefono|precio|total/i);
  });

  it('sin sesión responde 401', async () => {
    const res = await pedir(null);
    expect(res.status).toBe(401);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toMatch(/sesión/i);
  });

  it('con rol caja responde 403', async () => {
    const res = await pedir('caja');
    expect(res.status).toBe(403);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toMatch(/permiso/i);
  });

  it('si falla la lectura responde 500 con un mensaje en español', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const appQueFalla = crearApp({
      crearRepoCocina: () => ({
        leerPedidosActivos: () => Promise.reject(new Error('Supabase no responde')),
      }),
    });
    const res = await pedir('cocina', appQueFalla);
    expect(res.status).toBe(500);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toBe(
      'No se pudieron leer los pedidos. Intenta de nuevo en un momento.',
    );
  });

  it('aparece en el OpenAPI con el esquema Bearer', async () => {
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, { get?: { security?: unknown } }>;
    };
    expect(doc.paths['/cocina/pedidos']?.get?.security).toEqual([{ Bearer: [] }]);
  });
});
