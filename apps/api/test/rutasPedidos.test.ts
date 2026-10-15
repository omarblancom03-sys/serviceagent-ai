import {
  ErrorPedidoSchema,
  RespuestaCotizarPedidoSchema,
  RespuestaCrearPedidoSchema,
} from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import { firmar } from './firmaDePrueba';
import { crearRepoMenuEnMemoria, repoMenuQueFalla } from './menuEnMemoria';
import { crearRepoPedidosEnMemoria, repoPedidosQueFalla } from './pedidosEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

/*
 * POST /pedidos/cotizar y POST /pedidos con el menú real del seed y firmas como las de Retell. Los casos de negocio
 * (variantes, extras, aclaraciones, duplicados) se prueban en cotizacion.test.ts y pedido.test.ts;
 * aquí, lo que agrega la ruta.
 */

const seed = leerSeedMenu();
const app = crearApp({ crearRepoMenu: () => crearRepoMenuEnMemoria(seed.filas, seed.sinonimos) });
const appQueFalla = crearApp({ crearRepoMenu: () => repoMenuQueFalla });

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const env = { RETELL_API_KEY: LLAVE } as Bindings;

/** Cuerpo como lo manda Retell con "Payload: args only" apagado: `{ name, call, args }`. */
const sobre = (args: unknown, name = 'cotizar_pedido') =>
  JSON.stringify({ name, call: { call_id: 'chat_123' }, args });

async function cotizar(
  cuerpo: string,
  {
    firma,
    entorno = env,
    aplicacion = app,
    ruta = '/pedidos/cotizar',
  }: { firma?: string | null; entorno?: Bindings; aplicacion?: typeof app; ruta?: string } = {},
) {
  const encabezado = firma === undefined ? await firmar(cuerpo, LLAVE, Date.now()) : firma;
  return aplicacion.request(
    ruta,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(encabezado === null ? {} : { 'X-Retell-Signature': encabezado }),
      },
      body: cuerpo,
    },
    entorno,
  );
}

const DOS_TBONE_CON_ESPUELAS = sobre({
  productos: [{ producto: 't-bone', cantidad: 2, extras: [{ extra: 'espuelas', cantidad: 1 }] }],
});

describe('POST /pedidos/cotizar', () => {
  it('con firma válida cotiza con precios de la base: dos T-Bone con Espuelas → $916.00', async () => {
    const res = await cotizar(DOS_TBONE_CON_ESPUELAS);

    expect(res.status).toBe(200);
    expect(RespuestaCotizarPedidoSchema.parse(await res.json())).toMatchObject({
      ok: true,
      totalCentavos: 91600,
      totalTexto: '$916.00',
    });
  });

  it('responde 200 con ok: false y las aclaraciones si algo no se puede cotizar', async () => {
    const res = await cotizar(
      sobre({ productos: [{ producto: 'pizza de pepperoni', cantidad: 1 }] }),
    );

    expect(res.status).toBe(200);
    expect(RespuestaCotizarPedidoSchema.parse(await res.json())).toEqual({
      ok: false,
      aclaraciones: [
        { tipo: 'no_existe', origen: 'producto', indice: 0, producto: 'pizza de pepperoni' },
      ],
    });
  });

  it('rechaza con 401 una petición sin firma', async () => {
    const res = await cotizar(DOS_TBONE_CON_ESPUELAS, { firma: null });

    expect(res.status).toBe(401);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toBe('Firma de Retell inválida.');
  });

  it('rechaza con 401 si el cuerpo cambió después de firmarse', async () => {
    const firma = await firmar(DOS_TBONE_CON_ESPUELAS, LLAVE, Date.now());
    const alterado = DOS_TBONE_CON_ESPUELAS.replace('"cantidad":2', '"cantidad":20');

    expect((await cotizar(alterado, { firma })).status).toBe(401);
  });

  it('rechaza con 401 una firma hecha con otra llave', async () => {
    const firma = await firmar(DOS_TBONE_CON_ESPUELAS, 'otra_llave', Date.now());

    expect((await cotizar(DOS_TBONE_CON_ESPUELAS, { firma })).status).toBe(401);
  });

  it('revisa la firma antes que el cuerpo: mal formado y sin firma → 401, no 400', async () => {
    expect((await cotizar('{"name":"otra"}', { firma: null })).status).toBe(401);
  });

  it('con firma válida, una llave que no existe → 400 que nombra la llave, no solo "args"', async () => {
    const res = await cotizar(
      sobre({ productos: [{ producto: 't-bone', cantidad: 1 }], extrasSuelto: [] }),
    );

    expect(res.status).toBe(400);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toBe(
      'La petición de cotizar_pedido no tiene el formato esperado. Revisa: args.extrasSuelto.',
    );
  });

  it('con firma válida, montos en la petición → 400: el dinero nunca lo manda el agente', async () => {
    const res = await cotizar(
      sobre({
        productos: [{ producto: 't-bone', cantidad: 1, precioCentavos: 100 }],
        totalCentavos: 100,
      }),
    );

    expect(res.status).toBe(400);
    const { error } = ErrorPedidoSchema.parse(await res.json());
    expect(error).toContain('args.totalCentavos');
    expect(error).toContain('args.productos.0.precioCentavos');
  });

  it('con firma válida, un cuerpo que no es JSON → 400 (texto de Hono, antes de la ruta)', async () => {
    expect((await cotizar('no es json')).status).toBe(400);
  });

  it('con firma válida, otra función en `name` → 400', async () => {
    const cuerpo = JSON.stringify({ name: 'crear_pedido', args: { productos: [] } });

    const res = await cotizar(cuerpo);
    expect(res.status).toBe(400);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toContain('name');
  });

  it('responde 500 si falta RETELL_API_KEY, sin cotizar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await cotizar(DOS_TBONE_CON_ESPUELAS, { entorno: {} as Bindings });
    expect(res.status).toBe(500);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toBe(
      'El servicio no está configurado. Intenta más tarde.',
    );
  });

  it('responde 500 con mensaje en español si falla la lectura del menú', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await cotizar(DOS_TBONE_CON_ESPUELAS, { aplicacion: appQueFalla });
    expect(res.status).toBe(500);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toBe(
      'No se pudo cotizar el pedido. Intenta de nuevo en un momento.',
    );
    expect(consola).toHaveBeenCalled();
  });

  it('aparece en /openapi.json con sus respuestas y la firma de Retell', async () => {
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<
        string,
        { post?: { responses: Record<string, unknown>; security?: unknown[] } }
      >;
      components: { securitySchemes: Record<string, unknown> };
    };
    const ruta = doc.paths['/pedidos/cotizar']?.post;

    expect(Object.keys(ruta?.responses ?? {})).toEqual(['200', '400', '401', '500']);
    expect(ruta?.security).toEqual([{ FirmaRetell: [] }]);
    expect(doc.components.securitySchemes.FirmaRetell).toMatchObject({
      type: 'apiKey',
      in: 'header',
      name: 'X-Retell-Signature',
    });
  });
});

describe('POST /pedidos', () => {
  const repoMenu = () => crearRepoMenuEnMemoria(seed.filas, seed.sinonimos);
  const nuevaApp = () => {
    const repo = crearRepoPedidosEnMemoria();
    return { repo, app: crearApp({ crearRepoMenu: repoMenu, crearRepoPedidos: () => repo }) };
  };
  const PEDIDO = {
    productos: [{ producto: 't-bone', cantidad: 2, extras: [{ extra: 'espuelas', cantidad: 1 }] }],
    nombre: 'María José',
    telefono: '614 123 4567',
  };
  const crear = (cuerpo: string, opciones: Parameters<typeof cotizar>[1] = {}) =>
    cotizar(cuerpo, { ruta: '/pedidos', ...opciones });

  it('con firma válida guarda el pedido y responde folio y total en texto', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const res = await crear(sobre(PEDIDO, 'crear_pedido'), { aplicacion });

    expect(res.status).toBe(200);
    expect(RespuestaCrearPedidoSchema.parse(await res.json())).toMatchObject({
      ok: true,
      folio: 1001,
      folioTexto: '#1001',
      estado: 'confirmado',
      yaExistia: false,
      totalTexto: '$916.00',
    });
    expect(repo.pedidos).toHaveLength(1);
  });

  it('el mismo pedido otra vez devuelve el mismo folio con yaExistia', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    await crear(sobre(PEDIDO, 'crear_pedido'), { aplicacion });
    const res = await crear(sobre(PEDIDO, 'crear_pedido'), { aplicacion });

    expect(await res.json()).toMatchObject({ ok: true, folio: 1001, yaExistia: true });
    expect(repo.pedidos).toHaveLength(1);
  });

  it('con aclaraciones responde 200 con ok: false y no guarda nada', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const res = await crear(sobre({ ...PEDIDO, telefono: '123' }, 'crear_pedido'), { aplicacion });

    expect(res.status).toBe(200);
    expect(RespuestaCrearPedidoSchema.parse(await res.json())).toMatchObject({
      ok: false,
      datosCliente: [{ campo: 'telefono' }],
    });
    expect(repo.pedidos).toHaveLength(0);
  });

  it('rechaza con 401 sin firma y no guarda nada', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const res = await crear(sobre(PEDIDO, 'crear_pedido'), { aplicacion, firma: null });

    expect(res.status).toBe(401);
    expect(repo.pedidos).toHaveLength(0);
  });

  it('rechaza con 401 si el cuerpo cambió después de firmarse y no guarda nada', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const cuerpo = sobre(PEDIDO, 'crear_pedido');
    const firma = await firmar(cuerpo, LLAVE, Date.now());
    const alterado = cuerpo.replace('"cantidad":2', '"cantidad":20');

    expect((await crear(alterado, { aplicacion, firma })).status).toBe(401);
    expect(repo.pedidos).toHaveLength(0);
  });

  it('rechaza con 401 una firma vencida (más de 5 minutos) y no guarda nada', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const cuerpo = sobre(PEDIDO, 'crear_pedido');
    const firma = await firmar(cuerpo, LLAVE, Date.now() - 6 * 60_000);

    expect((await crear(cuerpo, { aplicacion, firma })).status).toBe(401);
    expect(repo.pedidos).toHaveLength(0);
  });

  it('un precio dentro de un producto → 400 que lo nombra y no guarda nada', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const productos = [{ ...PEDIDO.productos[0], precioCentavos: 100 }];
    const res = await crear(sobre({ ...PEDIDO, productos }, 'crear_pedido'), { aplicacion });

    expect(res.status).toBe(400);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toContain(
      'args.productos.0.precioCentavos',
    );
    expect(repo.pedidos).toHaveLength(0);
  });

  it('acepta el teléfono como número (sin comillas) y lo guarda como texto', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const res = await crear(sobre({ ...PEDIDO, telefono: 6141234567 }, 'crear_pedido'), {
      aplicacion,
    });

    expect(await res.json()).toMatchObject({ ok: true, folio: 1001 });
    expect(repo.pedidos[0]?.telefono).toBe('6141234567');
  });

  it('un total o precio que venga de afuera es un cuerpo mal formado → 400', async () => {
    const { app: aplicacion, repo } = nuevaApp();
    const res = await crear(sobre({ ...PEDIDO, totalCentavos: 100 }, 'crear_pedido'), {
      aplicacion,
    });

    expect(res.status).toBe(400);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toBe(
      'La petición de crear_pedido no tiene el formato esperado. Revisa: args.totalCentavos.',
    );
    expect(repo.pedidos).toHaveLength(0);
  });

  it('con el name de otra función → 400', async () => {
    const { app: aplicacion } = nuevaApp();
    expect((await crear(sobre(PEDIDO, 'cotizar_pedido'), { aplicacion })).status).toBe(400);
  });

  it('responde 500 en español si falla al guardar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const aplicacion = crearApp({
      crearRepoMenu: repoMenu,
      crearRepoPedidos: () => repoPedidosQueFalla,
    });

    const res = await crear(sobre(PEDIDO, 'crear_pedido'), { aplicacion });
    expect(res.status).toBe(500);
    expect(ErrorPedidoSchema.parse(await res.json()).error).toBe(
      'No se pudo registrar el pedido. Intenta de nuevo en un momento.',
    );
  });

  it('aparece en /openapi.json con sus respuestas y la firma de Retell', async () => {
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<
        string,
        { post?: { responses: Record<string, unknown>; security?: unknown[] } }
      >;
    };
    const ruta = doc.paths['/pedidos']?.post;

    expect(Object.keys(ruta?.responses ?? {})).toEqual(['200', '400', '401', '500']);
    expect(ruta?.security).toEqual([{ FirmaRetell: [] }]);
  });
});
