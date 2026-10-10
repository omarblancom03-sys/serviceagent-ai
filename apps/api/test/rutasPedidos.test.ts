import { ErrorPedidoSchema, RespuestaCotizarPedidoSchema } from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import { firmar } from './firmaDePrueba';
import { crearRepoMenuEnMemoria, repoMenuQueFalla } from './menuEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

/*
 * POST /pedidos/cotizar con el menú real del seed y firmas como las de Retell. Los casos de negocio
 * (variantes, extras, aclaraciones) se prueban en cotizacion.test.ts; aquí, lo que agrega la ruta.
 */

const seed = leerSeedMenu();
const app = crearApp({ crearRepoMenu: () => crearRepoMenuEnMemoria(seed.filas, seed.sinonimos) });
const appQueFalla = crearApp({ crearRepoMenu: () => repoMenuQueFalla });

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const env = { RETELL_API_KEY: LLAVE } as Bindings;

/** Cuerpo como lo manda Retell con "Payload: args only" apagado: `{ name, call, args }`. */
const sobre = (args: unknown) =>
  JSON.stringify({ name: 'cotizar_pedido', call: { call_id: 'chat_123' }, args });

async function cotizar(
  cuerpo: string,
  {
    firma,
    entorno = env,
    aplicacion = app,
  }: { firma?: string | null; entorno?: Bindings; aplicacion?: typeof app } = {},
) {
  const encabezado = firma === undefined ? await firmar(cuerpo, LLAVE, Date.now()) : firma;
  return aplicacion.request(
    '/pedidos/cotizar',
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
