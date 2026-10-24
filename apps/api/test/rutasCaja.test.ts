import { ErrorCajaSchema, RespuestaPedidosCajaSchema, type Rol } from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import { firmarToken } from '../src/lib/auth';
import type { Bindings } from '../src/lib/env';
import type { CajaRepo, PedidoCajaLeido } from '../src/services/caja';

const env = { JWT_SECRET: 'secreto-de-prueba-de-al-menos-32-caracteres' } as Bindings;

const pedidos: PedidoCajaLeido[] = [
  {
    folio: 1002,
    nombreCliente: 'Luis',
    telefono: '6145550102',
    estado: 'listo',
    totalCentavos: 20800,
    creadoEn: new Date('2026-10-21T18:05:00Z'),
    historial: [{ estado: 'listo', creadoEn: new Date('2026-10-21T18:25:00Z') }],
    pagos: [
      { metodo: 'efectivo', montoCentavos: 20800, creadoEn: new Date('2026-10-21T18:26:00Z') },
    ],
  },
  {
    folio: 1001,
    nombreCliente: 'María José',
    telefono: '6145550101',
    estado: 'en_cola',
    totalCentavos: 18800,
    creadoEn: new Date('2026-10-21T18:00:00Z'),
    historial: [{ estado: 'en_cola', creadoEn: new Date('2026-10-21T18:00:00Z') }],
    pagos: [],
  },
];

const repoCon = (lista: PedidoCajaLeido[]): CajaRepo => ({
  leerPedidosCaja: () => Promise.resolve(lista),
});
const app = crearApp({ crearRepoCaja: () => repoCon(pedidos) });

async function pedir(rol: Rol | null, aplicacion = app) {
  const headers: Record<string, string> = {};
  if (rol) {
    const { token } = await firmarToken(
      { sub: '00000000-0000-4000-8000-000000000002', rol },
      env.JWT_SECRET,
      3600,
    );
    headers.Authorization = `Bearer ${token}`;
  }
  return aplicacion.request('/caja/pedidos', { headers }, env);
}

describe('GET /caja/pedidos (US-20)', () => {
  it.each(['caja', 'admin'] as const)(
    'con rol %s devuelve los pedidos con su pago',
    async (rol) => {
      const res = await pedir(rol);
      expect(res.status).toBe(200);
      const respuesta = RespuestaPedidosCajaSchema.parse(await res.json());
      expect(respuesta.pedidos.map((p) => [p.folioTexto, p.pagado, p.metodosPago])).toEqual([
        ['#1001', false, []],
        ['#1002', true, ['efectivo']],
      ]);
    },
  );

  it('manda solo los últimos 4 dígitos del teléfono', async () => {
    const texto = await (await pedir('caja')).text();
    expect(texto).not.toMatch(/614555010[12]/);
    expect(texto).toContain('"telefonoFinal":"0101"');
  });

  it('sin sesión responde 401', async () => {
    const res = await pedir(null);
    expect(res.status).toBe(401);
    expect(ErrorCajaSchema.parse(await res.json()).error).toMatch(/sesión/i);
  });

  it('con rol cocina responde 403', async () => {
    const res = await pedir('cocina');
    expect(res.status).toBe(403);
    expect(ErrorCajaSchema.parse(await res.json()).error).toMatch(/permiso/i);
  });

  it('si falla la lectura responde 500 con un mensaje en español', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const appQueFalla = crearApp({
      crearRepoCaja: () => ({
        leerPedidosCaja: () => Promise.reject(new Error('Supabase no responde')),
      }),
    });
    const res = await pedir('caja', appQueFalla);
    expect(res.status).toBe(500);
    expect(ErrorCajaSchema.parse(await res.json()).error).toBe(
      'No se pudieron leer los pedidos. Intenta de nuevo en un momento.',
    );
  });

  it('aparece en el OpenAPI con el esquema Bearer', async () => {
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, { get?: { security?: unknown } }>;
    };
    expect(doc.paths['/caja/pedidos']?.get?.security).toEqual([{ Bearer: [] }]);
  });
});
