import {
  CrearPedidoArgsSchema,
  DatosTransferenciaSchema,
  PedirDatosWhatsappArgsSchema,
  RespuestaCrearPedidoSchema,
  RespuestaPedirDatosWhatsappSchema,
} from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoPedidos } from '../src/lib/repoPedidos';
import {
  DETALLE_FALTA_FOLIO,
  DETALLE_FALTA_METODO_EN_CAJA,
  DETALLE_FOLIO,
  DETALLE_METODO_EN_CAJA,
  DETALLE_SOLO_TRANSFERENCIA,
  DETALLE_TELEFONO_WHATSAPP,
  armarDatosTransferencia,
  formatearClabe,
  leerMetodoPago,
  metodosDisponibles,
  pedirDatosWhatsapp,
  validarMetodoPago,
} from '../src/services/pago';
import { crearPedido } from '../src/services/pedido';
import { crearRepoMenuEnMemoria } from './menuEnMemoria';
import { CLABE_DE_PRUEBA, crearRepoPedidosEnMemoria } from './pedidosEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

const seed = leerSeedMenu();
const repoMenu = () => crearRepoMenuEnMemoria(seed.filas, seed.sinonimos);

const CONFIRMADO = [
  { role: 'agent', content: '¿Confirmo tu pedido?' },
  { role: 'user', content: 'Sí' },
];

const PEDIDO = {
  productos: [{ producto: 't-bone', cantidad: 2, extras: [{ extra: 'espuelas', cantidad: 1 }] }],
  nombre: 'María José',
  telefono: '614 123 4567',
};

const crear = (args: Record<string, unknown>, repo = crearRepoPedidosEnMemoria()) =>
  crearPedido(repoMenu(), repo, CrearPedidoArgsSchema.parse({ ...PEDIDO, ...args }), CONFIRMADO);

describe('métodos de pago según el modo (US-23, D76)', () => {
  it('con pago al recoger se ofrece efectivo o tarjeta; con transferencia, solo transferencia', () => {
    expect(metodosDisponibles('al_recoger')).toEqual(['efectivo', 'tarjeta']);
    expect(metodosDisponibles('transferencia')).toEqual(['transferencia']);
  });

  it.each([
    ['efectivo', 'efectivo'],
    ['En efectivo', 'efectivo'],
    ['Tarjeta', 'tarjeta'],
    ['con tarjeta', 'tarjeta'],
    ['tarjeta de débito', 'tarjeta'],
    ['crédito', 'tarjeta'],
    ['Transferencia', 'transferencia'],
    ['SPEI', 'transferencia'],
  ])('lee "%s" como %s', (texto, metodo) => {
    expect(leerMetodoPago(texto)).toBe(metodo);
  });

  it.each(['bitcoin', 'vales', '', 'efectivo o tarjeta', 'lo que sea'])(
    'no adivina un método con "%s"',
    (texto) => {
      expect(leerMetodoPago(texto)).toBeNull();
    },
  );

  it('con pago al recoger exige efectivo o tarjeta y explica qué falta', () => {
    expect(validarMetodoPago('tarjeta', 'al_recoger')).toEqual({
      metodo: 'tarjeta',
      invalido: null,
    });
    expect(validarMetodoPago(undefined, 'al_recoger').invalido).toEqual({
      campo: 'metodoPago',
      detalle: DETALLE_FALTA_METODO_EN_CAJA,
    });
    expect(validarMetodoPago('transferencia', 'al_recoger').invalido).toEqual({
      campo: 'metodoPago',
      detalle: DETALLE_METODO_EN_CAJA,
    });
  });

  it('con transferencia el método puede faltar, pero no puede ser otro', () => {
    expect(validarMetodoPago(undefined, 'transferencia').metodo).toBe('transferencia');
    expect(validarMetodoPago('transferencia', 'transferencia').metodo).toBe('transferencia');
    expect(validarMetodoPago('efectivo', 'transferencia').invalido).toEqual({
      campo: 'metodoPago',
      detalle: DETALLE_SOLO_TRANSFERENCIA,
    });
  });
});

describe('datos de transferencia', () => {
  it('agrupa la CLABE en banco, plaza, cuenta y verificador', () => {
    expect(formatearClabe('999180157000000005')).toBe('999 180 15700000000 5');
  });

  it('arma CLABE, referencia y el monto del total guardado; sin referencia no hay datos', () => {
    const datos = armarDatosTransferencia('GRN-1001-K7', CLABE_DE_PRUEBA, 91600);
    expect(DatosTransferenciaSchema.parse(datos)).toEqual({
      clabe: '999180157000000005',
      clabeTexto: '999 180 15700000000 5',
      referencia: 'GRN-1001-K7',
      montoCentavos: 91600,
      montoTexto: '$916.00',
    });
    expect(armarDatosTransferencia(null, null, 91600)).toBeNull();
  });
});

describe('crearPedido con método de pago', () => {
  it('con pago al recoger guarda el método elegido y no manda datos de transferencia', async () => {
    const repo = crearRepoPedidosEnMemoria();
    const respuesta = await crear({ metodoPago: 'Con tarjeta' }, repo);
    expect(RespuestaCrearPedidoSchema.parse(respuesta)).toMatchObject({
      ok: true,
      modoPago: 'al_recoger',
      metodoPago: 'tarjeta',
      datosTransferencia: null,
    });
    expect(repo.pedidos[0]).toMatchObject({ metodoPago: 'tarjeta', referenciaPago: null });
  });

  it('con pago al recoger y sin método no guarda nada y pide el método', async () => {
    const repo = crearRepoPedidosEnMemoria();
    const respuesta = await crear({}, repo);
    expect(respuesta).toEqual({
      ok: false,
      faltaConfirmacion: false,
      aclaraciones: [],
      datosCliente: [{ campo: 'metodoPago', detalle: DETALLE_FALTA_METODO_EN_CAJA }],
    });
    expect(repo.pedidos).toHaveLength(0);
  });

  it('con pago al recoger no acepta transferencia: el restaurante no la tiene activa', async () => {
    const repo = crearRepoPedidosEnMemoria();
    const respuesta = await crear({ metodoPago: 'transferencia' }, repo);
    expect(respuesta).toMatchObject({
      ok: false,
      datosCliente: [{ campo: 'metodoPago', detalle: DETALLE_METODO_EN_CAJA }],
    });
    expect(repo.pedidos).toHaveLength(0);
  });

  it('con transferencia genera la referencia y devuelve CLABE, monto y referencia', async () => {
    const repo = crearRepoPedidosEnMemoria();
    repo.modoPago = 'transferencia';
    const respuesta = await crear({}, repo);
    expect(RespuestaCrearPedidoSchema.parse(respuesta)).toMatchObject({
      ok: true,
      estado: 'esperando_pago',
      metodoPago: 'transferencia',
      totalCentavos: 91600,
      datosTransferencia: {
        clabe: CLABE_DE_PRUEBA,
        clabeTexto: '999 180 15700000000 5',
        referencia: 'GRN-1001-K7',
        montoCentavos: 91600,
        montoTexto: '$916.00',
      },
    });
    expect(repo.pedidos[0]).toMatchObject({
      metodoPago: 'transferencia',
      referenciaPago: 'GRN-1001-K7',
    });
  });

  it('con transferencia el monto a transferir es siempre el total que calculó el backend', async () => {
    const repo = crearRepoPedidosEnMemoria();
    repo.modoPago = 'transferencia';
    const respuesta = await crear({ metodoPago: 'transferencia' }, repo);
    if (!respuesta.ok) throw new Error('debía crearse');
    expect(respuesta.datosTransferencia?.montoCentavos).toBe(respuesta.totalCentavos);
  });

  it('con transferencia, el duplicado devuelve la misma referencia (no genera otra)', async () => {
    const repo = crearRepoPedidosEnMemoria();
    repo.modoPago = 'transferencia';
    const primero = await crear({}, repo);
    const segundo = await crear({}, repo);
    if (!primero.ok || !segundo.ok) throw new Error('debían crearse');
    expect(segundo.yaExistia).toBe(true);
    expect(segundo.datosTransferencia).toEqual(primero.datosTransferencia);
    expect(repo.pedidos).toHaveLength(1);
  });

  it('con transferencia y otro método dice que solo se recibe transferencia', async () => {
    const repo = crearRepoPedidosEnMemoria();
    repo.modoPago = 'transferencia';
    const respuesta = await crear({ metodoPago: 'efectivo' }, repo);
    expect(respuesta).toMatchObject({
      ok: false,
      datosCliente: [{ campo: 'metodoPago', detalle: DETALLE_SOLO_TRANSFERENCIA }],
    });
    expect(repo.pedidos).toHaveLength(0);
  });

  it('sin confirmación no lee el modo ni guarda nada (D48 va primero)', async () => {
    const repo = crearRepoPedidosEnMemoria();
    let leyoModo = false;
    repo.leerModoPago = () => {
      leyoModo = true;
      return Promise.resolve('al_recoger');
    };
    const respuesta = await crearPedido(
      repoMenu(),
      repo,
      CrearPedidoArgsSchema.parse({ ...PEDIDO, metodoPago: 'efectivo' }),
      [],
    );
    expect(respuesta).toMatchObject({ ok: false, faltaConfirmacion: true });
    expect(leyoModo).toBe(false);
  });
});

describe('pedirDatosWhatsapp', () => {
  async function pedidoPorTransferencia() {
    const repo = crearRepoPedidosEnMemoria();
    repo.modoPago = 'transferencia';
    await crear({}, repo);
    return repo;
  }
  const pedir = (repo: ReturnType<typeof crearRepoPedidosEnMemoria>, args: unknown) =>
    pedirDatosWhatsapp(repo, PedirDatosWhatsappArgsSchema.parse(args));

  it('anota el pedido una sola vez; la segunda dice que ya estaba', async () => {
    const repo = await pedidoPorTransferencia();
    const primera = await pedir(repo, { folio: 1001, telefono: '614 123 4567' });
    expect(RespuestaPedirDatosWhatsappSchema.parse(primera)).toEqual({
      resultado: 'pedido',
      datosInvalidos: [],
    });
    expect(repo.pedidos[0]?.datosWhatsappPedidosEn).toEqual(repo.ahora);
    expect((await pedir(repo, { folio: '#1001', telefono: '6141234567' })).resultado).toBe(
      'ya_pedido',
    );
  });

  it('acepta el folio como "#1001", "1001" o número', async () => {
    for (const folio of ['#1001', '1001', 1001, ' # 1001 ']) {
      const repo = await pedidoPorTransferencia();
      expect((await pedir(repo, { folio, telefono: '6141234567' })).resultado).toBe('pedido');
    }
  });

  it('con otro teléfono responde no_encontrado sin revelar nada del pedido', async () => {
    const repo = await pedidoPorTransferencia();
    expect((await pedir(repo, { folio: 1001, telefono: '6149998877' })).resultado).toBe(
      'no_encontrado',
    );
    expect((await pedir(repo, { folio: 1002, telefono: '6141234567' })).resultado).toBe(
      'no_encontrado',
    );
    expect(repo.pedidos[0]?.datosWhatsappPedidosEn).toBeNull();
  });

  it('un pedido de pago en caja, o que ya no espera el pago, no aplica', async () => {
    const enCaja = crearRepoPedidosEnMemoria();
    await crear({ metodoPago: 'efectivo' }, enCaja);
    expect((await pedir(enCaja, { folio: 1001, telefono: '6141234567' })).resultado).toBe(
      'no_aplica',
    );

    const pagado = await pedidoPorTransferencia();
    if (pagado.pedidos[0]) pagado.pedidos[0].estado = 'en_cola';
    expect((await pedir(pagado, { folio: 1001, telefono: '6141234567' })).resultado).toBe(
      'no_aplica',
    );
  });

  it('sin folio o con teléfono inválido dice qué volver a pedir y no toca el repo', async () => {
    const repo = await pedidoPorTransferencia();
    repo.pedirDatosWhatsapp = () => {
      throw new Error('no debía llamarse');
    };
    expect(await pedir(repo, { telefono: '123' })).toEqual({
      resultado: 'datos_invalidos',
      datosInvalidos: [
        { campo: 'folio', detalle: DETALLE_FALTA_FOLIO },
        { campo: 'telefono', detalle: DETALLE_TELEFONO_WHATSAPP },
      ],
    });
    expect(await pedir(repo, { folio: 'mil uno', telefono: '6141234567' })).toEqual({
      resultado: 'datos_invalidos',
      datosInvalidos: [{ campo: 'folio', detalle: DETALLE_FOLIO }],
    });
    expect((await pedir(repo, { folio: 0, telefono: '6141234567' })).resultado).toBe(
      'datos_invalidos',
    );
  });
});

describe('crearRepoPedidos: método de pago y WhatsApp (US-23)', () => {
  const pedido = {
    nombreCliente: 'María José',
    telefono: '6141234567',
    huella: 'a'.repeat(64),
    totalCentavos: 14900,
    renglones: [],
    metodoPago: 'efectivo' as const,
  };

  function clienteQueAnota(respuesta: { data: unknown; error: unknown }) {
    const llamadas: { funcion: string; params: unknown }[] = [];
    const cliente = {
      rpc: (funcion: string, params: unknown) => {
        llamadas.push({ funcion, params });
        return Promise.resolve(respuesta);
      },
      from: () => ({
        select: () => ({ single: () => Promise.resolve(respuesta) }),
      }),
    } as unknown as SupabaseClient;
    return { cliente, llamadas };
  }

  it('manda el método a crear_pedido y lee método, referencia y CLABE', async () => {
    const { cliente, llamadas } = clienteQueAnota({
      data: [
        {
          folio_asignado: 1005,
          total_guardado: 14900,
          estado_actual: 'en_cola',
          ya_existia: false,
          modo_pago: 'al_recoger',
          metodo_pago: 'efectivo',
          referencia_pago: null,
          clabe_transferencia: null,
        },
      ],
      error: null,
    });
    const guardado = await crearRepoPedidos(cliente).guardarPedido(pedido, 10);
    expect(llamadas[0]?.params).toMatchObject({ p_metodo_pago: 'efectivo' });
    expect(guardado).toMatchObject({
      metodoPago: 'efectivo',
      referenciaPago: null,
      clabeTransferencia: null,
    });
  });

  it('rechaza una fila sin método (la función SQL de antes de US-23)', async () => {
    const { cliente } = clienteQueAnota({
      data: [
        {
          folio_asignado: 1005,
          total_guardado: 14900,
          estado_actual: 'en_cola',
          ya_existia: false,
          modo_pago: 'al_recoger',
        },
      ],
      error: null,
    });
    await expect(crearRepoPedidos(cliente).guardarPedido(pedido, 10)).rejects.toThrow();
  });

  it('lee el modo de pago de la configuración', async () => {
    const { cliente } = clienteQueAnota({ data: { modo_pago: 'transferencia' }, error: null });
    await expect(crearRepoPedidos(cliente).leerModoPago()).resolves.toBe('transferencia');
  });

  it('pedir_datos_whatsapp con folio y teléfono', async () => {
    const { cliente, llamadas } = clienteQueAnota({
      data: [{ resultado: 'pedido', pedido_en: '2026-11-17T18:00:00Z' }],
      error: null,
    });
    await expect(crearRepoPedidos(cliente).pedirDatosWhatsapp(1001, '6141234567')).resolves.toBe(
      'pedido',
    );
    expect(llamadas[0]).toEqual({
      funcion: 'pedir_datos_whatsapp',
      params: { p_folio: 1001, p_telefono: '6141234567' },
    });
  });

  it('propaga el error de la base con su mensaje', async () => {
    const { cliente } = clienteQueAnota({ data: null, error: { message: 'sin permiso' } });
    await expect(crearRepoPedidos(cliente).pedirDatosWhatsapp(1001, '6141234567')).rejects.toThrow(
      'No se pudo anotar el pedido de WhatsApp: sin permiso',
    );
    await expect(crearRepoPedidos(cliente).leerModoPago()).rejects.toThrow(
      'No se pudo leer el modo de pago: sin permiso',
    );
  });
});
