import {
  ConflictoCocinaSchema,
  ErrorCocinaSchema,
  RespuestaCambioEstadoCocinaSchema,
  RespuestaDeshacerCocinaSchema,
  RespuestaPedidosCocinaSchema,
  SEGUNDOS_DESHACER_PANTALLA,
  SEGUNDOS_DESHACER_SERVIDOR,
  type Rol,
} from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import { firmarToken } from '../src/lib/auth';
import type { Bindings } from '../src/lib/env';
import type { CocinaRepo, PedidoActivo } from '../src/services/cocina';
import { crearCocinaEnMemoria, pedidoEnCola } from './cocinaEnMemoria';

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
  ...crearCocinaEnMemoria().repo,
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
        ...crearCocinaEnMemoria().repo,
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

const ID_COCINA = '00000000-0000-4000-8000-0000000000c1';
const ID_ADMIN = '00000000-0000-4000-8000-0000000000a1';

/** App con un repo en memoria que imita las funciones SQL de cambio de estado. */
function montar() {
  const memoria = crearCocinaEnMemoria([pedidoEnCola(1001), pedidoEnCola(1002)]);
  const aplicacion = crearApp({ crearRepoCocina: () => memoria.repo });
  return { ...memoria, aplicacion };
}

async function encabezados(rol: Rol | null, sub = ID_COCINA) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (rol) {
    const { token } = await firmarToken({ sub, rol }, env.JWT_SECRET, 3600);
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function post(
  aplicacion: ReturnType<typeof crearApp>,
  ruta: string,
  opciones: { rol?: Rol | null; sub?: string; cuerpo?: unknown } = {},
) {
  const { rol = 'cocina', sub, cuerpo } = opciones;
  return aplicacion.request(
    ruta,
    {
      method: 'POST',
      headers: await encabezados(rol, sub),
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    },
    env,
  );
}

const segundos = (n: number) => n * 1000;

describe('POST /cocina/pedidos/{folio}/empezar y /terminar (US-11-P1)', () => {
  it('Empezar pasa de en_cola a preparando y guarda quién lo hizo, tomado de la sesión', async () => {
    const { aplicacion, pedidos, reloj } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/1001/empezar');

    expect(res.status).toBe(200);
    const cuerpo = RespuestaCambioEstadoCocinaSchema.parse(await res.json());
    expect(cuerpo).toEqual({
      folio: 1001,
      folioTexto: '#1001',
      estado: 'preparando',
      cambiadoEn: reloj.ahora.toISOString(),
      deshacerHasta: new Date(
        reloj.ahora.getTime() + segundos(SEGUNDOS_DESHACER_PANTALLA),
      ).toISOString(),
    });
    expect(pedidos[0]?.estado).toBe('preparando');
    expect(pedidos[0]?.historial.at(-1)).toMatchObject({
      estado: 'preparando',
      idEmpleado: ID_COCINA,
    });
  });

  it('ignora un idEmpleado mandado en el cuerpo', async () => {
    const { aplicacion, pedidos } = montar();
    await post(aplicacion, '/cocina/pedidos/1001/empezar', { cuerpo: { idEmpleado: ID_ADMIN } });
    expect(pedidos[0]?.historial.at(-1)?.idEmpleado).toBe(ID_COCINA);
  });

  it('Terminado pasa de preparando a listo y el pedido sale de GET /cocina/pedidos', async () => {
    const { aplicacion, pedidos } = montar();
    await post(aplicacion, '/cocina/pedidos/1001/empezar');
    const res = await post(aplicacion, '/cocina/pedidos/1001/terminar');

    expect(res.status).toBe(200);
    expect(RespuestaCambioEstadoCocinaSchema.parse(await res.json()).estado).toBe('listo');
    expect(pedidos[0]?.estado).toBe('listo');

    const lista = await aplicacion.request(
      '/cocina/pedidos',
      { headers: await encabezados('cocina') },
      env,
    );
    const { pedidos: tickets } = RespuestaPedidosCocinaSchema.parse(await lista.json());
    expect(tickets.map((t) => t.folio)).toEqual([1002]);
  });

  it('Terminado desde en_cola responde 409 con el estado actual y no cambia nada', async () => {
    const { aplicacion, pedidos } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/1001/terminar');

    expect(res.status).toBe(409);
    expect(ConflictoCocinaSchema.parse(await res.json())).toMatchObject({
      codigo: 'estado_cambio',
      estadoActual: 'en_cola',
    });
    expect(pedidos[0]?.estado).toBe('en_cola');
    expect(pedidos[0]?.historial).toHaveLength(2);
  });

  it('Empezar dos veces: la segunda responde 409 y el historial tiene un solo preparando', async () => {
    const { aplicacion, pedidos } = montar();
    expect((await post(aplicacion, '/cocina/pedidos/1001/empezar')).status).toBe(200);
    const res = await post(aplicacion, '/cocina/pedidos/1001/empezar');

    expect(res.status).toBe(409);
    const conflicto = ConflictoCocinaSchema.parse(await res.json());
    expect(conflicto.estadoActual).toBe('preparando');
    expect(conflicto.error).toMatch(/#1001/);
    expect(pedidos[0]?.historial.filter((h) => h.estado === 'preparando')).toHaveLength(1);
  });

  it('un folio que no existe responde 404', async () => {
    const { aplicacion } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/9999/empezar');
    expect(res.status).toBe(404);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toBe(
      'No encontramos un pedido con ese folio.',
    );
  });

  it.each(['abc', '0', '1e3', '-5', '99999999999'])('el folio %s responde 400', async (folio) => {
    const { aplicacion } = montar();
    const res = await post(aplicacion, `/cocina/pedidos/${folio}/empezar`);
    expect(res.status).toBe(400);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toBe(
      'El folio debe ser un entero positivo.',
    );
  });

  it('sin sesión responde 401 y con rol caja 403, sin cambiar el pedido', async () => {
    const { aplicacion, pedidos } = montar();
    const sinSesion = await post(aplicacion, '/cocina/pedidos/1001/empezar', { rol: null });
    expect(sinSesion.status).toBe(401);
    expect(ErrorCocinaSchema.parse(await sinSesion.json()).error).toMatch(/sesión/i);

    const caja = await post(aplicacion, '/cocina/pedidos/1001/terminar', { rol: 'caja' });
    expect(caja.status).toBe(403);
    expect(ErrorCocinaSchema.parse(await caja.json()).error).toMatch(/permiso/i);
    expect(pedidos[0]?.estado).toBe('en_cola');
  });

  it('admin también puede, y queda su id en el historial', async () => {
    const { aplicacion, pedidos } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/1001/empezar', {
      rol: 'admin',
      sub: ID_ADMIN,
    });
    expect(res.status).toBe(200);
    expect(pedidos[0]?.historial.at(-1)?.idEmpleado).toBe(ID_ADMIN);
  });

  it('si falla la base responde 500 con un mensaje en español', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const aplicacion = crearApp({
      crearRepoCocina: () => ({
        ...crearCocinaEnMemoria().repo,
        cambiarEstado: () => Promise.reject(new Error('Supabase no responde')),
      }),
    });
    const res = await post(aplicacion, '/cocina/pedidos/1001/terminar');
    expect(res.status).toBe(500);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toBe(
      'No se pudo guardar el cambio. Intenta de nuevo en un momento.',
    );
  });
});

describe('POST /cocina/pedidos/{folio}/deshacer (US-11-P1)', () => {
  it('deshace Empezar en el límite del plazo: vuelve a en_cola sin cambiar la hora de entrada a la cola', async () => {
    const { aplicacion, pedidos, reloj } = montar();
    await post(aplicacion, '/cocina/pedidos/1001/empezar');
    reloj.ahora = new Date(reloj.ahora.getTime() + segundos(SEGUNDOS_DESHACER_SERVIDOR));

    const res = await post(aplicacion, '/cocina/pedidos/1001/deshacer', {
      cuerpo: { estado: 'preparando' },
    });
    expect(res.status).toBe(200);
    expect(RespuestaDeshacerCocinaSchema.parse(await res.json())).toEqual({
      folio: 1001,
      folioTexto: '#1001',
      estado: 'en_cola',
    });
    expect(pedidos[0]?.estado).toBe('en_cola');
    expect(pedidos[0]?.historial.map((h) => h.estado)).toEqual(['confirmado', 'en_cola']);
    expect(pedidos[0]?.historial[1]?.creadoEn.toISOString()).toBe('2026-10-22T17:55:00.000Z');
  });

  it('deshace Terminado: vuelve a preparando', async () => {
    const { aplicacion, pedidos } = montar();
    await post(aplicacion, '/cocina/pedidos/1001/empezar');
    await post(aplicacion, '/cocina/pedidos/1001/terminar');

    const res = await post(aplicacion, '/cocina/pedidos/1001/deshacer', {
      cuerpo: { estado: 'listo' },
    });
    expect(res.status).toBe(200);
    expect(RespuestaDeshacerCocinaSchema.parse(await res.json()).estado).toBe('preparando');
    expect(pedidos[0]?.historial.map((h) => h.estado)).toEqual([
      'confirmado',
      'en_cola',
      'preparando',
    ]);
  });

  it('fuera del plazo responde 409 plazo_vencido y no cambia nada', async () => {
    const { aplicacion, pedidos, reloj } = montar();
    await post(aplicacion, '/cocina/pedidos/1001/empezar');
    reloj.ahora = new Date(reloj.ahora.getTime() + segundos(SEGUNDOS_DESHACER_SERVIDOR) + 1);

    const res = await post(aplicacion, '/cocina/pedidos/1001/deshacer', {
      cuerpo: { estado: 'preparando' },
    });
    expect(res.status).toBe(409);
    expect(ConflictoCocinaSchema.parse(await res.json())).toMatchObject({
      codigo: 'plazo_vencido',
      estadoActual: 'preparando',
    });
    expect(pedidos[0]?.estado).toBe('preparando');
    expect(pedidos[0]?.historial).toHaveLength(3);
  });

  it('deshacer un estado que no es el último cambio responde 409 estado_cambio', async () => {
    const { aplicacion, pedidos } = montar();
    await post(aplicacion, '/cocina/pedidos/1001/empezar');
    await post(aplicacion, '/cocina/pedidos/1001/terminar');

    const res = await post(aplicacion, '/cocina/pedidos/1001/deshacer', {
      cuerpo: { estado: 'preparando' },
    });
    expect(res.status).toBe(409);
    expect(ConflictoCocinaSchema.parse(await res.json())).toMatchObject({
      codigo: 'estado_cambio',
      estadoActual: 'listo',
    });
    expect(pedidos[0]?.estado).toBe('listo');
  });

  it('deshacer un pedido que nunca empezó responde 409', async () => {
    const { aplicacion } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/1002/deshacer', {
      cuerpo: { estado: 'preparando' },
    });
    expect(res.status).toBe(409);
    expect(ConflictoCocinaSchema.parse(await res.json()).estadoActual).toBe('en_cola');
  });

  it('un folio que no existe responde 404', async () => {
    const { aplicacion } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/9999/deshacer', {
      cuerpo: { estado: 'listo' },
    });
    expect(res.status).toBe(404);
  });

  it('un folio mal formado responde 400', async () => {
    const { aplicacion } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/abc/deshacer', {
      cuerpo: { estado: 'listo' },
    });
    expect(res.status).toBe(400);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toBe(
      'El folio debe ser un entero positivo.',
    );
  });

  it.each([
    ['sin estado', {}],
    ['un estado que no se deshace', { estado: 'en_cola' }],
    ['una llave de más', { estado: 'listo', idEmpleado: ID_ADMIN }],
  ])('un cuerpo %s responde 400 en español', async (_caso, cuerpo) => {
    const { aplicacion } = montar();
    const res = await post(aplicacion, '/cocina/pedidos/1001/deshacer', { cuerpo });
    expect(res.status).toBe(400);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toBe(
      'Indica qué estado quieres deshacer: preparando o listo.',
    );
  });

  it('un cuerpo que no es JSON responde 400 en español', async () => {
    const { aplicacion } = montar();
    const res = await aplicacion.request(
      '/cocina/pedidos/1001/deshacer',
      { method: 'POST', headers: await encabezados('cocina'), body: '{no es json' },
      env,
    );
    expect(res.status).toBe(400);
    expect(ErrorCocinaSchema.parse(await res.json()).error).toBe('La petición no es válida.');
  });

  it('sin sesión responde 401, con rol caja 403 y admin pasa', async () => {
    const { aplicacion } = montar();
    await post(aplicacion, '/cocina/pedidos/1001/empezar');
    const cuerpo = { estado: 'preparando' };
    const ruta = '/cocina/pedidos/1001/deshacer';

    expect((await post(aplicacion, ruta, { rol: null, cuerpo })).status).toBe(401);
    expect((await post(aplicacion, ruta, { rol: 'caja', cuerpo })).status).toBe(403);
    expect((await post(aplicacion, ruta, { rol: 'admin', cuerpo })).status).toBe(200);
  });
});

describe('cambio de estado en el OpenAPI (US-11-P1)', () => {
  it.each(['empezar', 'terminar', 'deshacer'])(
    'POST /cocina/pedidos/{folio}/%s aparece con Bearer y todas sus respuestas',
    async (accion) => {
      const doc = (await (await app.request('/openapi.json')).json()) as {
        paths: Record<string, { post?: { security?: unknown; responses?: object } }>;
      };
      const operacion = doc.paths[`/cocina/pedidos/{folio}/${accion}`]?.post;
      expect(operacion?.security).toEqual([{ Bearer: [] }]);
      expect(Object.keys(operacion?.responses ?? {}).sort()).toEqual([
        '200',
        '400',
        '401',
        '403',
        '404',
        '409',
        '500',
      ]);
    },
  );
});
