import {
  CotizarPedidoArgsSchema,
  CotizarPedidoPeticionSchema,
  RespuestaCotizarPedidoSchema,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';

const args = {
  productos: [
    {
      producto: 't bone',
      cantidad: 2,
      extras: [{ extra: 'Espuelas (camarones)', cantidad: 1 }],
    },
  ],
  extrasSueltos: [{ extra: 'Totopos', cantidad: 1 }],
};

const renglonPlatillo = {
  tipo: 'platillo',
  indice: 0,
  idPlatillo: 40,
  nombre: 'T-Bone 450 gr',
  idVariante: 70,
  variante: null,
  cantidad: 2,
  sinIngredientes: [],
  extras: [
    { idExtra: 5, nombre: 'Espuelas (camarones)', cantidad: 1, precioUnitarioCentavos: 5500 },
  ],
  precioUnitarioCentavos: 40300,
  subtotalCentavos: 91600,
  subtotalTexto: '$916.00',
};

const renglonExtra = {
  tipo: 'extra',
  indice: 0,
  idExtra: 1,
  nombre: 'Totopos',
  cantidad: 1,
  precioUnitarioCentavos: 2000,
  subtotalCentavos: 2000,
  subtotalTexto: '$20.00',
};

const respuestaOk = {
  ok: true,
  renglones: [renglonPlatillo, renglonExtra],
  totalCentavos: 93600,
  totalTexto: '$936.00',
};

describe('Contrato de cotizar pedido: petición', () => {
  it('acepta el sobre de Retell { name, call, args } y descarta call', () => {
    const peticion = CotizarPedidoPeticionSchema.parse({
      name: 'cotizar_pedido',
      call: { call_id: 'abc123', transcript: 'Quiero dos T-Bone con espuelas' },
      args,
    });
    expect(peticion.name).toBe('cotizar_pedido');
    expect(peticion.args.productos[0]?.producto).toBe('t bone');
    expect(peticion).not.toHaveProperty('call');
  });

  it('rechaza una función con otro name', () => {
    expect(() => CotizarPedidoPeticionSchema.parse({ name: 'crear_pedido', args })).toThrow();
  });

  it('rechaza args sin productos ni extras sueltos', () => {
    expect(() => CotizarPedidoArgsSchema.parse({})).toThrow();
    expect(() => CotizarPedidoArgsSchema.parse({ productos: [], extrasSueltos: [] })).toThrow();
  });

  it('acepta solo extras sueltos (productos vale [] por defecto)', () => {
    const soloExtras = CotizarPedidoArgsSchema.parse({ extrasSueltos: args.extrasSueltos });
    expect(soloExtras.productos).toEqual([]);
  });

  it.each([0, 21, 1.5])(
    'acepta la cantidad %s (la rechaza el servicio con cantidad_invalida, no zod)',
    (cantidad) => {
      const pedido = CotizarPedidoArgsSchema.parse({
        productos: [{ producto: 'Guacamole', cantidad }],
        extrasSueltos: [{ extra: 'Totopos', cantidad }],
      });
      expect(pedido.productos[0]?.cantidad).toBe(cantidad);
      expect(pedido.extrasSueltos[0]?.cantidad).toBe(cantidad);
    },
  );

  it.each(['', '   ', 'x'.repeat(81)])('rechaza el texto %j (vacío o de más de 80)', (texto) => {
    expect(() =>
      CotizarPedidoArgsSchema.parse({ productos: [{ producto: texto, cantidad: 1 }] }),
    ).toThrow();
    expect(() =>
      CotizarPedidoArgsSchema.parse({ extrasSueltos: [{ extra: texto, cantidad: 1 }] }),
    ).toThrow();
    expect(() =>
      CotizarPedidoArgsSchema.parse({
        productos: [{ producto: 'Guacamole', cantidad: 1, sinIngredientes: [texto] }],
      }),
    ).toThrow();
  });

  it('acepta un texto de 80 caracteres y le quita los espacios de los extremos', () => {
    const pedido = CotizarPedidoArgsSchema.parse({
      productos: [{ producto: ` ${'x'.repeat(80)} `, cantidad: 1 }],
    });
    expect(pedido.productos[0]?.producto).toHaveLength(80);
  });
});

describe('Contrato de cotizar pedido: respuesta', () => {
  it('acepta una cotización ok con un platillo y un extra suelto', () => {
    const respuesta = RespuestaCotizarPedidoSchema.parse(respuestaOk);
    expect(respuesta.ok).toBe(true);
    if (respuesta.ok) expect(respuesta.totalCentavos).toBe(93600);
  });

  it('acepta una respuesta con aclaraciones', () => {
    const respuesta = RespuestaCotizarPedidoSchema.parse({
      ok: false,
      aclaraciones: [
        {
          tipo: 'ambiguo',
          origen: 'producto',
          indice: 0,
          producto: 'arrachera',
          opciones: ['Arrachera 450 gr', 'Arrachera al Chipotle 450 gr'],
        },
        {
          tipo: 'extra_no_permitido',
          origen: 'extraSuelto',
          indice: 0,
          producto: 'espuelas',
          detalle: 'Espuelas (camarones)',
        },
      ],
    });
    expect(respuesta.ok).toBe(false);
  });

  it('rechaza ok: false sin aclaraciones y un tipo de aclaración desconocido', () => {
    expect(() => RespuestaCotizarPedidoSchema.parse({ ok: false, aclaraciones: [] })).toThrow();
    expect(() =>
      RespuestaCotizarPedidoSchema.parse({
        ok: false,
        aclaraciones: [{ tipo: 'otro', origen: 'producto', indice: 0, producto: 'x' }],
      }),
    ).toThrow();
  });

  it.each([-100, 123.45])('rechaza el monto %s (debe ser entero y no negativo)', (monto) => {
    expect(() =>
      RespuestaCotizarPedidoSchema.parse({ ...respuestaOk, totalCentavos: monto }),
    ).toThrow();
    expect(() =>
      RespuestaCotizarPedidoSchema.parse({
        ...respuestaOk,
        renglones: [{ ...renglonPlatillo, precioUnitarioCentavos: monto }],
      }),
    ).toThrow();
    expect(() =>
      RespuestaCotizarPedidoSchema.parse({
        ...respuestaOk,
        renglones: [{ ...renglonExtra, subtotalCentavos: monto }],
      }),
    ).toThrow();
  });
});
