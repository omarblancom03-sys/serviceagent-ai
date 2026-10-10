import {
  CotizarPedidoArgsSchema,
  CotizarPedidoPeticionSchema,
  CrearPedidoArgsSchema,
  CrearPedidoPeticionSchema,
  RespuestaCotizarPedidoSchema,
  RespuestaCrearPedidoSchema,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';

const args = {
  productos: [
    {
      producto: 't bone',
      cantidad: 2,
      extras: [{ extra: 'Espuelas', cantidad: 1 }],
    },
  ],
  extrasSueltos: [{ extra: 'Totopos', cantidad: 1 }],
};

const extraEspuelas = {
  idExtra: 5,
  nombre: 'Espuelas (camarones)',
  cantidad: 1,
  precioUnitarioCentavos: 5500,
  precioUnitarioTexto: '$55.00',
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
  extras: [extraEspuelas],
  precioUnitarioCentavos: 40300,
  precioUnitarioTexto: '$403.00',
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
  precioUnitarioTexto: '$20.00',
  subtotalCentavos: 2000,
  subtotalTexto: '$20.00',
};

/** Copia del objeto sin `campo`, para probar que un campo es obligatorio. */
const sinCampo = (objeto: object, campo: string) =>
  Object.fromEntries(Object.entries(objeto).filter(([llave]) => llave !== campo));

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

  it('rechaza args con una llave desconocida (p. ej. extrasSuelto mal escrito)', () => {
    expect(() =>
      CotizarPedidoArgsSchema.parse({
        productos: args.productos,
        extrasSuelto: args.extrasSueltos,
      }),
    ).toThrow();
  });

  it('rechaza un producto con una llave desconocida', () => {
    expect(() =>
      CotizarPedidoArgsSchema.parse({
        productos: [{ producto: 'Guacamole', cantidad: 1, sinIngrediente: ['cebolla'] }],
      }),
    ).toThrow();
  });

  it.each([
    ['variante: null', { variante: null }],
    ['variante: ""', { variante: '' }],
    ['variante: "   "', { variante: '   ' }],
    ['sinIngredientes: null', { sinIngredientes: null }],
    ['extras: null', { extras: null }],
  ])('toma %s como si el campo opcional no hubiera venido', (_caso, campo) => {
    const pedido = CotizarPedidoArgsSchema.parse({
      productos: [{ producto: 'Guacamole', cantidad: 1, ...campo }],
    });
    const [producto] = pedido.productos;
    expect(producto?.variante).toBeUndefined();
    expect(producto?.sinIngredientes).toBeUndefined();
    expect(producto?.extras).toBeUndefined();
  });

  it('toma extrasSueltos: null como lista vacía', () => {
    const pedido = CotizarPedidoArgsSchema.parse({
      productos: args.productos,
      extrasSueltos: null,
    });
    expect(pedido.extrasSueltos).toEqual([]);
  });

  it('toma productos: null como lista vacía si hay extras sueltos', () => {
    const pedido = CotizarPedidoArgsSchema.parse({
      productos: null,
      extrasSueltos: args.extrasSueltos,
    });
    expect(pedido.productos).toEqual([]);
    expect(pedido.extrasSueltos).toHaveLength(1);
  });

  it('sigue rechazando args con productos y extrasSueltos en null', () => {
    expect(() => CotizarPedidoArgsSchema.parse({ productos: null, extrasSueltos: null })).toThrow();
  });

  it.each([
    ['producto: null', { producto: null }],
    ['producto: ""', { producto: '' }],
    ['cantidad: null', { cantidad: null }],
  ])('rechaza %s (los campos obligatorios no aceptan null ni vacío)', (_caso, campo) => {
    expect(() =>
      CotizarPedidoArgsSchema.parse({
        productos: [{ producto: 'Guacamole', cantidad: 1, ...campo }],
      }),
    ).toThrow();
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
          producto: 'fajitas',
          opciones: [
            'Fajitas de arrachera',
            'Fajitas Trío',
            'Fajitas de pollo',
            'Fajitas de pollo infantil',
            'Fajitas de arrachera infantil',
          ],
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

  it('rechaza un renglón de platillo sin precioUnitarioTexto (el campo es obligatorio)', () => {
    expect(() =>
      RespuestaCotizarPedidoSchema.parse({
        ...respuestaOk,
        renglones: [sinCampo(renglonPlatillo, 'precioUnitarioTexto'), renglonExtra],
      }),
    ).toThrow();
  });

  it('rechaza un extra aplicado sin precioUnitarioTexto (el campo es obligatorio)', () => {
    expect(() =>
      RespuestaCotizarPedidoSchema.parse({
        ...respuestaOk,
        renglones: [
          { ...renglonPlatillo, extras: [sinCampo(extraEspuelas, 'precioUnitarioTexto')] },
          renglonExtra,
        ],
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

describe('Contrato de crear pedido', () => {
  const cliente = { nombre: 'Ana', telefono: '6141234567' };

  it('acepta el sobre de Retell con el pedido, nombre y teléfono', () => {
    const peticion = CrearPedidoPeticionSchema.parse({
      name: 'crear_pedido',
      call: { call_id: 'chat_1' },
      args: { ...args, ...cliente },
    });
    expect(peticion.args).toMatchObject(cliente);
  });

  it('rechaza el sobre de cotizar_pedido y viceversa', () => {
    const sobre = { name: 'cotizar_pedido', args: { ...args, ...cliente } };
    expect(CrearPedidoPeticionSchema.safeParse(sobre).success).toBe(false);
    expect(CotizarPedidoPeticionSchema.safeParse({ ...sobre, name: 'crear_pedido' }).success).toBe(
      false,
    );
  });

  it('nunca acepta montos de afuera: totalCentavos es una llave desconocida', () => {
    expect(CrearPedidoArgsSchema.safeParse({ ...args, ...cliente, totalCentavos: 1 }).success).toBe(
      false,
    );
  });

  it('nombre y teléfono en null o "" valen como "no vino" (los aclara el servicio)', () => {
    expect(CrearPedidoArgsSchema.parse({ ...args, nombre: null, telefono: '  ' })).toMatchObject({
      nombre: undefined,
      telefono: undefined,
    });
  });

  it('el teléfono como número se convierte a texto (la regla de 10 dígitos la revisa el servicio)', () => {
    expect(
      CrearPedidoArgsSchema.parse({ ...args, ...cliente, telefono: 6141234567 }),
    ).toMatchObject({ telefono: '6141234567' });
  });

  it('sigue exigiendo al menos un producto o extra suelto', () => {
    expect(CrearPedidoArgsSchema.safeParse({ ...cliente }).success).toBe(false);
  });

  it('respuesta: ok: false necesita al menos una aclaración del pedido o del cliente', () => {
    const sinNada = { ok: false, aclaraciones: [], datosCliente: [] };
    expect(RespuestaCrearPedidoSchema.safeParse(sinNada).success).toBe(false);
    const conDato = { ...sinNada, datosCliente: [{ campo: 'telefono', detalle: 'x' }] };
    expect(RespuestaCrearPedidoSchema.safeParse(conDato).success).toBe(true);
  });
});
