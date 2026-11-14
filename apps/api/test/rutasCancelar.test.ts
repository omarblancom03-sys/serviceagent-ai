import {
  CancelarPedidoArgsSchema,
  ErrorPedidoSchema,
  RespuestaCancelarPedidoSchema,
  type EstadoPedido,
} from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import { crearRepoCancelaciones } from '../src/lib/repoCancelaciones';
import {
  cancelarPedido,
  DETALLE_MOTIVO_CANCELACION_LARGO,
  DETALLE_RECHAZO,
  type CancelacionesRepo,
} from '../src/services/cancelacion';
import { DETALLE_FALTA_TELEFONO, DETALLE_TELEFONO } from '../src/services/pedido';
import {
  crearRepoCancelacionesEnMemoria,
  pedidoCancelable,
  repoCancelacionesQueFalla,
} from './cancelacionesEnMemoria';
import { firmar } from './firmaDePrueba';

/* US-14-P1 (D71): `cancelar_pedido`, el cliente cancela su pedido por el agente. */

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const env = { RETELL_API_KEY: LLAVE } as Bindings;
const TELEFONO = '6141234567';
const MOTIVO = 'Ya no va a poder pasar por él.';
const args = (cambios: Record<string, unknown> = {}) => ({
  folio: 1001,
  telefono: TELEFONO,
  motivo: MOTIVO,
  ...cambios,
});

/** Cuerpo como lo manda Retell en un agente de chat: `{ name, chat, args }`. */
const sobre = (a: unknown, name = 'cancelar_pedido') =>
  JSON.stringify({ name, chat: { chat_id: 'chat_1', transcript: 'User: hola' }, args: a });

async function cancelar(
  cuerpo: string,
  {
    repo = crearRepoCancelacionesEnMemoria(),
    firma,
    entorno = env,
  }: { repo?: CancelacionesRepo; firma?: string | null; entorno?: Bindings } = {},
) {
  const encabezado = firma === undefined ? await firmar(cuerpo, LLAVE, Date.now()) : firma;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (encabezado !== null) headers['X-Retell-Signature'] = encabezado;
  const res = await crearApp({ crearRepoCancelaciones: () => repo }).request(
    '/pedidos/cancelar',
    { method: 'POST', body: cuerpo, headers },
    entorno,
  );
  return { status: res.status, json: (await res.json()) as unknown };
}

/** Respuesta 200 ya validada contra el contrato. */
async function respuesta(a: unknown, repo: CancelacionesRepo) {
  const { status, json } = await cancelar(sobre(a), { repo });
  expect(status).toBe(200);
  return RespuestaCancelarPedidoSchema.parse(json);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /pedidos/cancelar: firma y formato', () => {
  it('401 sin firma, con firma de otro cuerpo o vencida, sin llamar al repo', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);
    const cuerpo = sobre(args());
    const vencida = await firmar(cuerpo, LLAVE, Date.now() - 6 * 60_000);

    for (const firma of [null, await firmar('otro', LLAVE, Date.now()), vencida]) {
      expect((await cancelar(cuerpo, { repo, firma })).status).toBe(401);
    }
    expect(repo.llamadas).toBe(0);
    expect(repo.pedidos[0]?.estado).toBe('en_cola');
  });

  it('500 si falta RETELL_API_KEY', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await cancelar(sobre(args()), { entorno: {} as Bindings })).status).toBe(500);
  });

  it.each([
    ['llave de más', args({ estado: 'cancelado' }), 'args.estado'],
    ['sin motivo', { folio: 1001, telefono: TELEFONO }, 'args.motivo'],
    ['motivo en blanco', args({ motivo: '   ' }), 'args.motivo'],
    ['motivo de 1001 caracteres', args({ motivo: 'a'.repeat(1001) }), 'args.motivo'],
    ['folio como texto', args({ folio: '1001' }), 'args.folio'],
    ['folio con decimales', args({ folio: 1001.5 }), 'args.folio'],
    ['folio negativo', args({ folio: -1 }), 'args.folio'],
    ['folio en cero', args({ folio: 0 }), 'args.folio'],
    ['folio enorme', args({ folio: 2_147_483_648 }), 'args.folio'],
  ])('400 con %s, nombrando el campo y sin llamar al repo', async (_caso, a, campo) => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);
    const { status, json } = await cancelar(sobre(a), { repo });
    expect(status).toBe(400);
    expect(ErrorPedidoSchema.parse(json).error).toContain(campo);
    expect(repo.llamadas).toBe(0);
  });

  it('400 si el sobre es de otra función', async () => {
    expect((await cancelar(sobre(args(), 'crear_pedido'))).status).toBe(400);
  });
});

describe('POST /pedidos/cancelar: cancela', () => {
  it.each<EstadoPedido>(['confirmado', 'esperando_pago', 'en_cola'])(
    'un pedido en %s queda cancelado, con el motivo en el historial',
    async (estado) => {
      const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, estado)]);

      expect(await respuesta(args(), repo)).toEqual({
        ok: true,
        folio: 1001,
        folioTexto: '#1001',
        estado: 'cancelado',
        yaEstabaCancelado: false,
      });
      expect(repo.pedidos[0]?.estado).toBe('cancelado');
      expect(repo.pedidos[0]?.historial.at(-1)).toEqual({ estado: 'cancelado', motivo: MOTIVO });
    },
  );

  it.each(['614 123 4567', '(614) 123-4567', '+52 614 123 4567', 6141234567])(
    'acepta el teléfono como lo dijo el cliente: %j',
    async (telefono) => {
      const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);
      expect((await respuesta(args({ telefono }), repo)).ok).toBe(true);
    },
  );

  it('si ya estaba cancelado responde ok con yaEstabaCancelado y no agrega otra fila', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);
    await respuesta(args(), repo);

    expect(await respuesta(args({ motivo: 'Otra vez.' }), repo)).toMatchObject({
      ok: true,
      yaEstabaCancelado: true,
    });
    expect(repo.pedidos[0]?.historial.filter((h) => h.estado === 'cancelado')).toEqual([
      { estado: 'cancelado', motivo: MOTIVO },
    ]);
  });

  it('solo cancela el pedido de ese folio', async () => {
    const repo = crearRepoCancelacionesEnMemoria([
      pedidoCancelable(1001, 'en_cola'),
      pedidoCancelable(1002, 'en_cola'),
    ]);
    await respuesta(args({ folio: 1002 }), repo);
    expect(repo.pedidos.map((p) => p.estado)).toEqual(['en_cola', 'cancelado']);
  });

  it('la respuesta no repite el teléfono ni el motivo', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);
    const texto = JSON.stringify(await respuesta(args(), repo));
    expect(texto).not.toContain(TELEFONO);
    expect(texto).not.toContain(MOTIVO);
  });
});

describe('POST /pedidos/cancelar: no cancela', () => {
  const rechazo = (codigo: keyof typeof DETALLE_RECHAZO, estadoActual: EstadoPedido | null) => ({
    ok: false,
    rechazo: codigo,
    estadoActual,
    detalle: DETALLE_RECHAZO[codigo],
    faltaFolio: false,
    datosCliente: [],
    aclaracionMotivo: null,
  });

  it('un folio que no existe y el folio de otro teléfono dan la misma respuesta', async () => {
    const repo = crearRepoCancelacionesEnMemoria([
      pedidoCancelable(1001, 'en_cola', { telefono: '6149998877' }),
    ]);

    const deOtro = await respuesta(args(), repo);
    const inexistente = await respuesta(args({ folio: 4321 }), repo);

    expect(deOtro).toEqual(rechazo('no_encontrado', null));
    expect(inexistente).toEqual(deOtro);
    expect(repo.pedidos[0]?.estado).toBe('en_cola');
  });

  it.each<[EstadoPedido, keyof typeof DETALLE_RECHAZO]>([
    ['preparando', 'en_preparacion'],
    ['listo', 'en_preparacion'],
    ['entregado', 'cerrado'],
    ['expirado', 'cerrado'],
  ])('un pedido en %s responde %s y no cambia', async (estado, codigo) => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, estado)]);

    expect(await respuesta(args(), repo)).toEqual(rechazo(codigo, estado));
    expect(repo.pedidos[0]?.estado).toBe(estado);
    expect(repo.pedidos[0]?.historial).toHaveLength(1);
  });

  it('en preparación, el detalle le dice al agente que ofrezca hablar con un empleado', () => {
    expect(DETALLE_RECHAZO.en_preparacion).toContain('no se puede cancelar');
    expect(DETALLE_RECHAZO.en_preparacion).toContain('hablar con un empleado');
    expect(DETALLE_RECHAZO.con_pago).toContain('hablar con un empleado');
  });

  it('un pedido en cola que ya tiene un pago responde con_pago y no cambia', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola', { pagos: 1 })]);

    expect(await respuesta(args(), repo)).toEqual(rechazo('con_pago', 'en_cola'));
    expect(repo.pedidos[0]?.estado).toBe('en_cola');
  });

  it('un pedido listo y pagado responde en_preparacion: el estado va antes que el pago', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'listo', { pagos: 1 })]);
    expect(await respuesta(args(), repo)).toEqual(rechazo('en_preparacion', 'listo'));
  });
});

describe('POST /pedidos/cancelar: falta algo por corregir', () => {
  const pendiente = (cambios: Record<string, unknown>) => ({
    ok: false,
    rechazo: null,
    estadoActual: null,
    detalle: null,
    faltaFolio: false,
    datosCliente: [],
    aclaracionMotivo: null,
    ...cambios,
  });

  it.each([
    ['sin folio', args({ folio: undefined }), pendiente({ faltaFolio: true })],
    ['folio en null', args({ folio: null }), pendiente({ faltaFolio: true })],
    ['folio vacío', args({ folio: '' }), pendiente({ faltaFolio: true })],
    [
      'sin teléfono',
      args({ telefono: undefined }),
      pendiente({ datosCliente: [{ campo: 'telefono', detalle: DETALLE_FALTA_TELEFONO }] }),
    ],
    [
      'teléfono de 7 dígitos',
      args({ telefono: '1234567' }),
      pendiente({ datosCliente: [{ campo: 'telefono', detalle: DETALLE_TELEFONO }] }),
    ],
    [
      'motivo de 201 caracteres',
      args({ motivo: 'a'.repeat(201) }),
      pendiente({ aclaracionMotivo: DETALLE_MOTIVO_CANCELACION_LARGO }),
    ],
  ])('%s: lo dice y no toca la base', async (_caso, a, esperado) => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);

    expect(await respuesta(a, repo)).toEqual(esperado);
    expect(repo.llamadas).toBe(0);
    expect(repo.pedidos[0]?.estado).toBe('en_cola');
  });

  it('todo lo que falta sale junto en una sola respuesta', async () => {
    const repo = crearRepoCancelacionesEnMemoria();
    expect(await respuesta({ telefono: 'abc', motivo: 'b'.repeat(300) }, repo)).toEqual(
      pendiente({
        faltaFolio: true,
        datosCliente: [{ campo: 'telefono', detalle: DETALLE_TELEFONO }],
        aclaracionMotivo: DETALLE_MOTIVO_CANCELACION_LARGO,
      }),
    );
  });

  it('un motivo de exactamente 200 caracteres sí cancela', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);
    expect((await respuesta(args({ motivo: 'a'.repeat(200) }), repo)).ok).toBe(true);
  });
});

describe('POST /pedidos/cancelar: fallas y Swagger', () => {
  it('si falla la base responde 500 con un mensaje en español, sin detalles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, json } = await cancelar(sobre(args()), { repo: repoCancelacionesQueFalla() });
    expect(status).toBe(500);
    expect(ErrorPedidoSchema.parse(json).error).toBe(
      'No se pudo cancelar el pedido. Intenta de nuevo en un momento.',
    );
  });

  it('aparece en /openapi.json con la firma de Retell', async () => {
    const res = await crearApp().request('/openapi.json', {}, env);
    const doc = (await res.json()) as { paths: Record<string, { post?: { security?: unknown } }> };
    expect(doc.paths['/pedidos/cancelar']?.post?.security).toEqual([{ FirmaRetell: [] }]);
  });

  it('los args son estrictos y aceptan el folio ausente', () => {
    expect(CancelarPedidoArgsSchema.safeParse(args()).success).toBe(true);
    expect(CancelarPedidoArgsSchema.safeParse({ telefono: TELEFONO, motivo: MOTIVO }).success).toBe(
      true,
    );
    expect(CancelarPedidoArgsSchema.safeParse(args({ nombre: 'Ana' })).success).toBe(false);
  });
});

describe('repoCancelaciones sobre Supabase', () => {
  type Respuesta = { data: unknown; error: { code?: string; message: string } | null };
  function clienteFalso(respuestaRpc: Respuesta) {
    const llamadas: unknown[][] = [];
    const cliente = {
      rpc: (funcion: string, params: unknown) => {
        llamadas.push([funcion, params]);
        return Promise.resolve(respuestaRpc);
      },
    } as unknown as SupabaseClient;
    return { repo: crearRepoCancelaciones(cliente), llamadas };
  }
  const datos = { folio: 1001, telefono: TELEFONO, motivo: MOTIVO };
  const fila = (resultado: string, estado: string | null) => ({
    data: [{ resultado, estado_actual: estado, cancelado_en: null }],
    error: null,
  });

  it('llama a cancelar_pedido_cliente con folio, teléfono y motivo', async () => {
    const { repo, llamadas } = clienteFalso(fila('cancelado', 'cancelado'));
    expect(await repo.cancelarPedido(datos)).toEqual({ resultado: 'cancelado' });
    expect(llamadas).toEqual([
      ['cancelar_pedido_cliente', { p_folio: 1001, p_telefono: TELEFONO, p_motivo: MOTIVO }],
    ]);
  });

  it.each([
    [fila('ya_cancelado', 'cancelado'), { resultado: 'ya_cancelado' }],
    [fila('no_encontrado', null), { resultado: 'no_encontrado' }],
    [fila('con_pago', 'en_cola'), { resultado: 'con_pago', estadoActual: 'en_cola' }],
    [
      fila('no_cancelable', 'preparando'),
      { resultado: 'no_cancelable', estadoActual: 'preparando' },
    ],
  ])('traduce la fila de la función', async (respuestaRpc, esperado) => {
    expect(await clienteFalso(respuestaRpc).repo.cancelarPedido(datos)).toEqual(esperado);
  });

  it.each([
    ['sin filas', { data: [], error: null }],
    ['un resultado desconocido', fila('borrado', null)],
    ['no_cancelable sin estado', fila('no_cancelable', null)],
    ['un estado que no existe', fila('con_pago', 'volando')],
  ])('falla con %s', async (_caso, respuestaRpc) => {
    await expect(clienteFalso(respuestaRpc).repo.cancelarPedido(datos)).rejects.toThrow();
  });

  it('el error de la base lleva solo el código: ni teléfono ni motivo', async () => {
    const { repo } = clienteFalso({
      data: null,
      error: { code: '42501', message: `permission denied para ${TELEFONO}: ${MOTIVO}` },
    });
    const error = await repo.cancelarPedido(datos).catch((e: unknown) => e);
    expect(String(error)).toContain('42501');
    expect(String(error)).not.toContain(TELEFONO);
    expect(String(error)).not.toContain(MOTIVO);
  });
});

describe('cancelarPedido (servicio)', () => {
  it('manda a la base el teléfono ya normalizado a 10 dígitos', async () => {
    const recibidos: unknown[] = [];
    const repo: CancelacionesRepo = {
      cancelarPedido: (d) => {
        recibidos.push(d);
        return Promise.resolve({ resultado: 'cancelado' });
      },
    };
    await cancelarPedido(
      repo,
      CancelarPedidoArgsSchema.parse(args({ telefono: '+52 (614) 123-4567' })),
    );
    expect(recibidos).toEqual([{ folio: 1001, telefono: TELEFONO, motivo: MOTIVO }]);
  });
});
