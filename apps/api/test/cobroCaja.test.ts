import {
  ConflictoCajaSchema,
  ErrorCajaSchema,
  RespuestaCobroCajaSchema,
  RespuestaEntregaCajaSchema,
  RespuestaPedidosCajaSchema,
  type EstadoPedido,
  type Rol,
} from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import { firmarToken } from '../src/lib/auth';
import type { Bindings } from '../src/lib/env';
import { crearRepoCaja } from '../src/lib/repoCaja';
import { armarPedidosCaja, cobrarPedidoCaja, entregarPedidoCaja } from '../src/services/caja';
import { crearCajaEnMemoria, type PedidoCajaEnMemoria } from './cajaEnMemoria';

/*
 * Cobro en caja y entrega (US-21, D66): servicio sobre el repo en memoria, rutas y repo de Supabase.
 * El candado de la base (dos cajas a la vez) se prueba con supabase/ensayos/caja_cobro_entrega.sql.
 */

const t = (iso: string) => new Date(iso);
const CAJERA = '00000000-0000-4000-8000-000000000002';
const OTRO = '00000000-0000-4000-8000-000000000009';

const pedido = (
  folio: number,
  estado: EstadoPedido,
  extra: Partial<PedidoCajaEnMemoria> = {},
): PedidoCajaEnMemoria => ({
  folio,
  nombreCliente: `Cliente ${folio}`,
  telefono: '6145550101',
  estado,
  totalCentavos: 18800,
  creadoEn: t('2026-11-12T17:00:00Z'),
  historial: [{ estado, creadoEn: t('2026-11-12T17:00:00Z'), idEmpleado: null }],
  pagos: [],
  ...extra,
});

const pagoCompleto = (metodo: 'efectivo' | 'tarjeta' | 'transferencia' = 'tarjeta') => ({
  metodo,
  montoCentavos: 18800,
  creadoEn: t('2026-11-12T17:30:00Z'),
  idEmpleado: metodo === 'transferencia' ? null : OTRO,
});

describe('cobrarPedidoCaja (US-21)', () => {
  it('cobra el total de un pedido sin pagos y guarda quién cobró y a qué hora', async () => {
    const { repo, pedidos, reloj } = crearCajaEnMemoria([pedido(1001, 'en_cola')]);
    reloj.ahora = t('2026-11-12T18:05:00Z');

    const resultado = await cobrarPedidoCaja(repo, 1001, 'efectivo', CAJERA);

    expect(resultado).toEqual({
      tipo: 'ok',
      respuesta: {
        folio: 1001,
        folioTexto: '#1001',
        metodo: 'efectivo',
        montoCentavos: 18800,
        montoTexto: '$188.00',
        cobradoEn: '2026-11-12T18:05:00.000Z',
      },
    });
    expect(pedidos[0]?.pagos).toEqual([
      {
        metodo: 'efectivo',
        montoCentavos: 18800,
        creadoEn: t('2026-11-12T18:05:00Z'),
        idEmpleado: CAJERA,
      },
    ]);
  });

  it('después de cobrar, la lista de caja lo trae pagado, con su método y nada por cobrar', async () => {
    const { repo } = crearCajaEnMemoria([pedido(1001, 'listo')]);
    const antes = armarPedidosCaja(await repo.leerPedidosCaja(t('2026-11-12T06:00:00Z')));
    expect(antes[0]).toMatchObject({
      pagado: false,
      porCobrarCentavos: 18800,
      porCobrarTexto: '$188.00',
    });

    await cobrarPedidoCaja(repo, 1001, 'tarjeta', CAJERA);

    const [despues] = armarPedidosCaja(await repo.leerPedidosCaja(t('2026-11-12T06:00:00Z')));
    expect(despues).toMatchObject({
      pagado: true,
      metodosPago: ['tarjeta'],
      porCobrarCentavos: 0,
      porCobrarTexto: '$0.00',
    });
    expect(RespuestaPedidosCajaSchema.safeParse({ pedidos: [despues] }).success).toBe(true);
  });

  it('con un pago parcial cobra solo lo que falta: el monto lo calcula la base', async () => {
    const parcial = { ...pagoCompleto('transferencia'), montoCentavos: 5000 };
    const { repo, pedidos } = crearCajaEnMemoria([
      pedido(1001, 'preparando', { pagos: [parcial] }),
    ]);

    const resultado = await cobrarPedidoCaja(repo, 1001, 'efectivo', CAJERA);

    expect(resultado).toMatchObject({
      tipo: 'ok',
      respuesta: { montoCentavos: 13800, montoTexto: '$138.00' },
    });
    expect(pedidos[0]?.pagos.map((p) => p.montoCentavos)).toEqual([5000, 13800]);
  });

  it('no cobra dos veces el mismo pedido', async () => {
    const { repo, pedidos } = crearCajaEnMemoria([pedido(1001, 'listo')]);
    await cobrarPedidoCaja(repo, 1001, 'efectivo', CAJERA);

    const segundo = await cobrarPedidoCaja(repo, 1001, 'tarjeta', OTRO);

    expect(segundo).toEqual({
      tipo: 'conflicto',
      conflicto: {
        error: 'El pedido #1001 ya está pagado.',
        codigo: 'ya_pagado',
        estadoActual: 'listo',
      },
    });
    expect(pedidos[0]?.pagos).toHaveLength(1);
  });

  it('dos cajas que cobran a la vez: una cobra y la otra se entera de que ya está pagado', async () => {
    const { repo, pedidos } = crearCajaEnMemoria([pedido(1001, 'listo')]);

    const resultados = await Promise.all([
      cobrarPedidoCaja(repo, 1001, 'efectivo', CAJERA),
      cobrarPedidoCaja(repo, 1001, 'tarjeta', OTRO),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['conflicto', 'ok']);
    expect(pedidos[0]?.pagos).toHaveLength(1);
  });

  it.each([
    ['cancelado', 'El pedido #1001 está cancelado: no se cobra.'],
    ['expirado', 'El pedido #1001 expiró: no se cobra.'],
    ['entregado', 'El pedido #1001 ya se entregó.'],
    ['esperando_pago', 'El pedido #1001 espera una transferencia: todavía no se cobra en caja.'],
    ['confirmado', 'El pedido #1001 espera una transferencia: todavía no se cobra en caja.'],
  ] as const)('no cobra un pedido %s', async (estado, texto) => {
    const { repo, pedidos } = crearCajaEnMemoria([pedido(1001, estado)]);

    const resultado = await cobrarPedidoCaja(repo, 1001, 'efectivo', CAJERA);

    expect(resultado).toEqual({
      tipo: 'conflicto',
      conflicto: { error: texto, codigo: 'estado_no_cobrable', estadoActual: estado },
    });
    expect(pedidos[0]?.pagos).toEqual([]);
  });

  it('un pedido cancelado que ya estaba pagado dice que ya está pagado, no que no se cobra', async () => {
    const { repo } = crearCajaEnMemoria([pedido(1001, 'cancelado', { pagos: [pagoCompleto()] })]);
    const resultado = await cobrarPedidoCaja(repo, 1001, 'efectivo', CAJERA);
    expect(resultado).toMatchObject({ tipo: 'conflicto', conflicto: { codigo: 'ya_pagado' } });
  });

  it('un folio que no existe', async () => {
    const { repo } = crearCajaEnMemoria([]);
    expect(await cobrarPedidoCaja(repo, 9999, 'efectivo', CAJERA)).toEqual({ tipo: 'no_existe' });
  });
});

describe('entregarPedidoCaja (US-21)', () => {
  it('entrega un pedido listo y pagado, con la hora y el empleado en el historial', async () => {
    const { repo, pedidos, reloj } = crearCajaEnMemoria([
      pedido(1001, 'listo', { pagos: [pagoCompleto()] }),
    ]);
    reloj.ahora = t('2026-11-12T18:20:00Z');

    const resultado = await entregarPedidoCaja(repo, 1001, CAJERA);

    expect(resultado).toEqual({
      tipo: 'ok',
      respuesta: {
        folio: 1001,
        folioTexto: '#1001',
        estado: 'entregado',
        entregadoEn: '2026-11-12T18:20:00.000Z',
      },
    });
    expect(pedidos[0]?.estado).toBe('entregado');
    expect(pedidos[0]?.historial.at(-1)).toEqual({
      estado: 'entregado',
      creadoEn: t('2026-11-12T18:20:00Z'),
      idEmpleado: CAJERA,
    });
  });

  it('no entrega un pedido listo que no se ha cobrado', async () => {
    const { repo, pedidos } = crearCajaEnMemoria([pedido(1001, 'listo')]);

    const resultado = await entregarPedidoCaja(repo, 1001, CAJERA);

    expect(resultado).toEqual({
      tipo: 'conflicto',
      conflicto: {
        error: 'Cobra el pedido #1001 antes de entregarlo.',
        codigo: 'falta_pago',
        estadoActual: 'listo',
      },
    });
    expect(pedidos[0]?.estado).toBe('listo');
  });

  it('cobrar y luego entregar cierra el pedido', async () => {
    const { repo, pedidos } = crearCajaEnMemoria([pedido(1001, 'listo')]);
    await cobrarPedidoCaja(repo, 1001, 'efectivo', CAJERA);
    expect((await entregarPedidoCaja(repo, 1001, CAJERA)).tipo).toBe('ok');
    expect(pedidos[0]?.estado).toBe('entregado');
  });

  it.each([
    ['en_cola', 'El pedido #1001 ya no está listo para entregar. Actualiza la lista.'],
    ['preparando', 'El pedido #1001 ya no está listo para entregar. Actualiza la lista.'],
    ['entregado', 'El pedido #1001 ya se entregó.'],
    ['cancelado', 'El pedido #1001 está cancelado.'],
  ] as const)('no entrega un pedido %s aunque esté pagado', async (estado, texto) => {
    const { repo, pedidos } = crearCajaEnMemoria([
      pedido(1001, estado, { pagos: [pagoCompleto()] }),
    ]);

    const resultado = await entregarPedidoCaja(repo, 1001, CAJERA);

    expect(resultado).toEqual({
      tipo: 'conflicto',
      conflicto: { error: texto, codigo: 'estado_cambio', estadoActual: estado },
    });
    expect(pedidos[0]?.estado).toBe(estado);
  });

  it('dos cajas que entregan a la vez: solo una lo entrega', async () => {
    const { repo, pedidos } = crearCajaEnMemoria([
      pedido(1001, 'listo', { pagos: [pagoCompleto()] }),
    ]);

    const resultados = await Promise.all([
      entregarPedidoCaja(repo, 1001, CAJERA),
      entregarPedidoCaja(repo, 1001, OTRO),
    ]);

    expect(resultados.map((r) => r.tipo).sort()).toEqual(['conflicto', 'ok']);
    expect(pedidos[0]?.historial.filter((h) => h.estado === 'entregado')).toHaveLength(1);
  });

  it('un folio que no existe', async () => {
    const { repo } = crearCajaEnMemoria([]);
    expect(await entregarPedidoCaja(repo, 9999, CAJERA)).toEqual({ tipo: 'no_existe' });
  });
});

// ─── Rutas ──────────────────────────────────────────────────────────────────

const env = { JWT_SECRET: 'secreto-de-prueba-de-al-menos-32-caracteres' } as Bindings;

function appCon(pedidos: PedidoCajaEnMemoria[]) {
  const enMemoria = crearCajaEnMemoria(pedidos);
  return { app: crearApp({ crearRepoCaja: () => enMemoria.repo }), ...enMemoria };
}

async function llamar(
  app: ReturnType<typeof crearApp>,
  ruta: string,
  rol: Rol | null,
  cuerpo?: unknown,
  sub = CAJERA,
) {
  const headers: Record<string, string> = {};
  if (rol) {
    const { token } = await firmarToken({ sub, rol }, env.JWT_SECRET, 3600);
    headers.Authorization = `Bearer ${token}`;
  }
  let body: string | undefined;
  if (cuerpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  }
  const res = await app.request(ruta, { method: 'POST', headers, body }, env);
  return { status: res.status, json: (await res.json()) as unknown };
}

describe('POST /caja/pedidos/{folio}/cobrar y /entregar: permisos', () => {
  const rutas = [
    ['/caja/pedidos/1001/cobrar', { metodo: 'efectivo' }],
    ['/caja/pedidos/1001/entregar', undefined],
  ] as const;

  it.each(rutas)('%s sin sesión responde 401 y no cambia nada', async (ruta, cuerpo) => {
    const { app, pedidos } = appCon([pedido(1001, 'listo')]);
    const { status, json } = await llamar(app, ruta, null, cuerpo);
    expect(status).toBe(401);
    expect(ErrorCajaSchema.parse(json).error).toMatch(/sesión/i);
    expect(pedidos[0]).toMatchObject({ estado: 'listo', pagos: [] });
  });

  it.each(rutas)('%s con rol cocina responde 403 y no cambia nada', async (ruta, cuerpo) => {
    const { app, pedidos } = appCon([pedido(1001, 'listo')]);
    const { status, json } = await llamar(app, ruta, 'cocina', cuerpo);
    expect(status).toBe(403);
    expect(ErrorCajaSchema.parse(json).error).toMatch(/permiso/i);
    expect(pedidos[0]).toMatchObject({ estado: 'listo', pagos: [] });
  });

  it('aparecen en el OpenAPI con el esquema Bearer', async () => {
    const { app } = appCon([]);
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, { post?: { security?: unknown } }>;
    };
    for (const ruta of ['/caja/pedidos/{folio}/cobrar', '/caja/pedidos/{folio}/entregar']) {
      expect(doc.paths[ruta]?.post?.security).toEqual([{ Bearer: [] }]);
    }
  });
});

describe('POST /caja/pedidos/{folio}/cobrar (US-21)', () => {
  it.each(['caja', 'admin'] as const)(
    'con rol %s cobra y el pago queda a nombre del empleado de la sesión',
    async (rol) => {
      const { app, pedidos } = appCon([pedido(1001, 'en_cola')]);

      const { status, json } = await llamar(app, '/caja/pedidos/1001/cobrar', rol, {
        metodo: 'tarjeta',
      });

      expect(status).toBe(200);
      expect(RespuestaCobroCajaSchema.parse(json)).toMatchObject({
        folioTexto: '#1001',
        metodo: 'tarjeta',
        montoCentavos: 18800,
        montoTexto: '$188.00',
      });
      expect(pedidos[0]?.pagos).toMatchObject([{ metodo: 'tarjeta', idEmpleado: CAJERA }]);
    },
  );

  it('ignora un empleado que venga en el cuerpo: el cuerpo estricto lo rechaza', async () => {
    const { app, pedidos } = appCon([pedido(1001, 'en_cola')]);
    const { status } = await llamar(app, '/caja/pedidos/1001/cobrar', 'caja', {
      metodo: 'efectivo',
      idEmpleado: OTRO,
    });
    expect(status).toBe(400);
    expect(pedidos[0]?.pagos).toEqual([]);
  });

  it.each([
    ['un monto en el cuerpo', { metodo: 'efectivo', montoCentavos: 1 }],
    ['transferencia', { metodo: 'transferencia' }],
    ['un método desconocido', { metodo: 'cheque' }],
    ['sin método', {}],
    ['JSON mal formado', '{metodo:'],
  ])('con %s responde 400 y no cobra', async (_, cuerpo) => {
    const { app, pedidos } = appCon([pedido(1001, 'en_cola')]);

    const { status, json } = await llamar(app, '/caja/pedidos/1001/cobrar', 'caja', cuerpo);

    expect(status).toBe(400);
    expect(ErrorCajaSchema.parse(json).error).not.toBe('');
    expect(pedidos[0]?.pagos).toEqual([]);
  });

  it.each(['abc', '0', '1e3', '-5', '99999999999'])(
    'con el folio "%s" responde 400',
    async (folio) => {
      const { app } = appCon([pedido(1001, 'en_cola')]);
      const { status, json } = await llamar(app, `/caja/pedidos/${folio}/cobrar`, 'caja', {
        metodo: 'efectivo',
      });
      expect(status).toBe(400);
      expect(ErrorCajaSchema.parse(json).error).toBe('El folio debe ser un entero positivo.');
    },
  );

  it('un folio que no existe responde 404', async () => {
    const { app } = appCon([]);
    const { status, json } = await llamar(app, '/caja/pedidos/1234/cobrar', 'caja', {
      metodo: 'efectivo',
    });
    expect(status).toBe(404);
    expect(ErrorCajaSchema.parse(json).error).toBe('No encontramos un pedido con ese folio.');
  });

  it('cobrar un pedido ya pagado responde 409 ya_pagado', async () => {
    const { app } = appCon([pedido(1001, 'listo', { pagos: [pagoCompleto()] })]);
    const { status, json } = await llamar(app, '/caja/pedidos/1001/cobrar', 'caja', {
      metodo: 'efectivo',
    });
    expect(status).toBe(409);
    expect(ConflictoCajaSchema.parse(json)).toMatchObject({
      codigo: 'ya_pagado',
      estadoActual: 'listo',
    });
  });

  it('cobrar un pedido cancelado responde 409 estado_no_cobrable', async () => {
    const { app } = appCon([pedido(1001, 'cancelado')]);
    const { status, json } = await llamar(app, '/caja/pedidos/1001/cobrar', 'caja', {
      metodo: 'efectivo',
    });
    expect(status).toBe(409);
    expect(ConflictoCajaSchema.parse(json).codigo).toBe('estado_no_cobrable');
  });

  it('si falla la base responde 500 con un mensaje en español', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, repo } = appCon([pedido(1001, 'listo')]);
    repo.cobrarPedido = () => Promise.reject(new Error('Supabase no responde'));

    const { status, json } = await llamar(app, '/caja/pedidos/1001/cobrar', 'caja', {
      metodo: 'efectivo',
    });

    expect(status).toBe(500);
    expect(ErrorCajaSchema.parse(json).error).toBe(
      'No se pudo guardar. Intenta de nuevo en un momento.',
    );
  });
});

describe('POST /caja/pedidos/{folio}/entregar (US-21)', () => {
  it('entrega un pedido listo y pagado a nombre del empleado de la sesión', async () => {
    const { app, pedidos } = appCon([pedido(1001, 'listo', { pagos: [pagoCompleto()] })]);

    const { status, json } = await llamar(app, '/caja/pedidos/1001/entregar', 'caja');

    expect(status).toBe(200);
    expect(RespuestaEntregaCajaSchema.parse(json)).toMatchObject({
      folioTexto: '#1001',
      estado: 'entregado',
    });
    expect(pedidos[0]?.historial.at(-1)).toMatchObject({
      estado: 'entregado',
      idEmpleado: CAJERA,
    });
  });

  it('un idEmpleado en el cuerpo no cambia quién entrega: la ruta no lee el cuerpo', async () => {
    const { app, pedidos } = appCon([pedido(1001, 'listo', { pagos: [pagoCompleto()] })]);

    const { status } = await llamar(app, '/caja/pedidos/1001/entregar', 'caja', {
      idEmpleado: OTRO,
    });

    expect(status).toBe(200);
    expect(pedidos[0]?.historial.at(-1)).toMatchObject({
      estado: 'entregado',
      idEmpleado: CAJERA,
    });
  });

  it('sin cobrar responde 409 falta_pago', async () => {
    const { app } = appCon([pedido(1001, 'listo')]);
    const { status, json } = await llamar(app, '/caja/pedidos/1001/entregar', 'caja');
    expect(status).toBe(409);
    expect(ConflictoCajaSchema.parse(json)).toMatchObject({
      codigo: 'falta_pago',
      estadoActual: 'listo',
    });
  });

  it('un pedido que no está listo responde 409 estado_cambio', async () => {
    const { app } = appCon([pedido(1001, 'preparando', { pagos: [pagoCompleto()] })]);
    const { status, json } = await llamar(app, '/caja/pedidos/1001/entregar', 'caja');
    expect(status).toBe(409);
    expect(ConflictoCajaSchema.parse(json)).toMatchObject({
      codigo: 'estado_cambio',
      estadoActual: 'preparando',
    });
  });

  it('folio mal formado 400 y folio inexistente 404', async () => {
    const { app } = appCon([]);
    expect((await llamar(app, '/caja/pedidos/abc/entregar', 'caja')).status).toBe(400);
    expect((await llamar(app, '/caja/pedidos/1234/entregar', 'caja')).status).toBe(404);
  });

  it('si falla la base responde 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, repo } = appCon([pedido(1001, 'listo')]);
    repo.entregarPedido = () => Promise.reject(new Error('Supabase no responde'));
    expect((await llamar(app, '/caja/pedidos/1001/entregar', 'caja')).status).toBe(500);
  });
});

// ─── Repo de Supabase ───────────────────────────────────────────────────────

/** Cliente de Supabase falso: solo `rpc`, con la respuesta que diga cada test. */
function clienteRpc(respuesta: { data: unknown; error: { message: string } | null }) {
  const llamadas: { funcion: string; params: unknown }[] = [];
  const cliente = {
    rpc: (funcion: string, params: unknown) => {
      llamadas.push({ funcion, params });
      return Promise.resolve(respuesta);
    },
  } as unknown as SupabaseClient;
  return { repo: crearRepoCaja(cliente), llamadas };
}

describe('crearRepoCaja: cobrar y entregar (Supabase)', () => {
  it('cobrarPedido llama a cobrar_pedido_caja y lee el pago', async () => {
    const { repo, llamadas } = clienteRpc({
      data: [
        {
          resultado: 'cobrado',
          estado_actual: 'listo',
          cobrado_centavos: 18800,
          cobrado_en: '2026-11-12T18:05:00.123456+00:00',
        },
      ],
      error: null,
    });

    const cobro = await repo.cobrarPedido({ folio: 1001, metodo: 'efectivo', idEmpleado: CAJERA });

    expect(cobro).toEqual({
      resultado: 'cobrado',
      montoCentavos: 18800,
      cobradoEn: t('2026-11-12T18:05:00.123Z'),
    });
    expect(llamadas).toEqual([
      {
        funcion: 'cobrar_pedido_caja',
        params: { p_folio: 1001, p_metodo: 'efectivo', p_id_empleado: CAJERA },
      },
    ]);
  });

  it.each(['ya_pagado', 'estado_no_cobrable'] as const)(
    'cobrarPedido lee el rechazo %s con el estado actual',
    async (resultado) => {
      const { repo } = clienteRpc({
        data: [{ resultado, estado_actual: 'entregado', cobrado_centavos: null, cobrado_en: null }],
        error: null,
      });
      expect(
        await repo.cobrarPedido({ folio: 1001, metodo: 'tarjeta', idEmpleado: CAJERA }),
      ).toEqual({ resultado, estadoActual: 'entregado' });
    },
  );

  it('entregarPedido llama a entregar_pedido_caja y lee la hora', async () => {
    const { repo, llamadas } = clienteRpc({
      data: [
        {
          resultado: 'entregado',
          estado_actual: 'entregado',
          entregado_en: '2026-11-12T18:20:00+00:00',
        },
      ],
      error: null,
    });

    expect(await repo.entregarPedido({ folio: 1001, idEmpleado: CAJERA })).toEqual({
      resultado: 'entregado',
      entregadoEn: t('2026-11-12T18:20:00Z'),
    });
    expect(llamadas).toEqual([
      { funcion: 'entregar_pedido_caja', params: { p_folio: 1001, p_id_empleado: CAJERA } },
    ]);
  });

  it.each(['estado_distinto', 'falta_pago'] as const)(
    'entregarPedido lee el rechazo %s',
    async (resultado) => {
      const { repo } = clienteRpc({
        data: [{ resultado, estado_actual: 'listo', entregado_en: null }],
        error: null,
      });
      expect(await repo.entregarPedido({ folio: 1001, idEmpleado: CAJERA })).toEqual({
        resultado,
        estadoActual: 'listo',
      });
    },
  );

  it('cero filas es un folio que no existe', async () => {
    const { repo } = clienteRpc({ data: [], error: null });
    expect(
      await repo.cobrarPedido({ folio: 1, metodo: 'efectivo', idEmpleado: CAJERA }),
    ).toBeNull();
    expect(await repo.entregarPedido({ folio: 1, idEmpleado: CAJERA })).toBeNull();
  });

  it('si Supabase falla, lanza un error', async () => {
    const { repo } = clienteRpc({ data: null, error: { message: 'sin permiso' } });
    await expect(
      repo.cobrarPedido({ folio: 1, metodo: 'efectivo', idEmpleado: CAJERA }),
    ).rejects.toThrow('No se pudo cobrar el pedido: sin permiso');
    await expect(repo.entregarPedido({ folio: 1, idEmpleado: CAJERA })).rejects.toThrow(
      'No se pudo entregar el pedido: sin permiso',
    );
  });

  it('rechaza un resultado que no conoce', async () => {
    const { repo } = clienteRpc({
      data: [{ resultado: 'otro', estado_actual: 'listo' }],
      error: null,
    });
    await expect(
      repo.cobrarPedido({ folio: 1, metodo: 'efectivo', idEmpleado: CAJERA }),
    ).rejects.toThrow();
    await expect(repo.entregarPedido({ folio: 1, idEmpleado: CAJERA })).rejects.toThrow();
  });
});
