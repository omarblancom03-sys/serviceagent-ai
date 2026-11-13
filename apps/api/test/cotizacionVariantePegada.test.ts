import {
  CotizarPedidoArgsSchema,
  CotizarPedidoPeticionSchema,
  CrearPedidoArgsSchema,
  RespuestaCotizarPedidoSchema,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  armarCatalogo,
  cotizarPedido,
  separarVariantePegada,
  variantesEnExtras,
} from '../src/services/cotizacion';
import { armarMenu } from '../src/services/menu';
import { leerSeedMenu } from './seedEnMemoria';

/*
 * US-07-P2-T2 (D67), con el menú real del seed: la variante que el modelo no manda en su campo
 * (pegada en `producto` con "con", o como extra suelto) y la llamada sin ningún platillo.
 */

const seed = leerSeedMenu();
const catalogo = armarCatalogo(armarMenu(seed.filas), seed.sinonimos);

/** La petición pasa por el esquema de la ruta y la respuesta se valida contra el contrato. */
const cotizar = (args: unknown) =>
  RespuestaCotizarPedidoSchema.parse(cotizarPedido(catalogo, CotizarPedidoArgsSchema.parse(args)));
const uno = (producto: string, extra: Record<string, unknown> = {}) => ({
  productos: [{ producto, cantidad: 1, ...extra }],
});
function aclaraciones(args: unknown) {
  const respuesta = cotizar(args);
  if (respuesta.ok) throw new Error(`Se esperaban aclaraciones: ${JSON.stringify(respuesta)}`);
  return respuesta.aclaraciones;
}
/** "Nombre (variante)" de cada renglón y el total, de una cotización que debe salir bien. */
function resumen(args: unknown) {
  const respuesta = cotizar(args);
  if (!respuesta.ok) throw new Error(`Se esperaba ok: ${JSON.stringify(respuesta)}`);
  return {
    renglones: respuesta.renglones.map((r) =>
      r.tipo === 'platillo' && r.variante ? `${r.nombre} (${r.variante})` : r.nombre,
    ),
    total: respuesta.totalCentavos,
  };
}

const TIRAS_BBQ = { renglones: ['Tiras de pollo (Salsa BBQ)'], total: 18600 };
const SALSAS = ['Salsa Búfalo', 'Salsa BBQ'];

describe('variante pegada en producto con "con" (D67)', () => {
  it.each([
    'tiras de pollo con salsa BBQ',
    'Tiras de pollo con salsa bbq',
    'unas tiras de pollo con salsa BBQ',
    'tiras de pollo con BBQ',
    'tiras de pollo con salsa BBQ para llevar',
  ])('"%s" → Tiras de pollo, variante Salsa BBQ, sin cobrar un extra', (producto) => {
    expect(resumen(uno(producto))).toEqual(TIRAS_BBQ);
  });

  it('respeta la cantidad y lo demás del renglón', () => {
    expect(resumen(uno('tiras de pollo con salsa búfalo', { cantidad: 2 }))).toEqual({
      renglones: ['Tiras de pollo (Salsa Búfalo)'],
      total: 37200,
    });
  });

  it('funciona con otro platillo: "queso fundido con chorizo"', () => {
    expect(resumen(uno('queso fundido con chorizo'))).toEqual({
      renglones: ['Queso fundido (Chorizo)'],
      total: 13400,
    });
  });

  it('"guacamole con totopos" no se parte: totopos no es una presentación del guacamole', () => {
    expect(separarVariantePegada(catalogo, 'guacamole con totopos')).toBeNull();
    // Sigue como antes: es un sinónimo del Guacamole, y no cobra Totopos como extra (D31).
    expect(resumen(uno('guacamole con totopos'))).toEqual({
      renglones: ['Guacamole'],
      total: 12300,
    });
  });

  it('"guacamole con chorizo" no se parte ni se resuelve: no existe', () => {
    expect(separarVariantePegada(catalogo, 'guacamole con chorizo')).toBeNull();
    expect(aclaraciones(uno('guacamole con chorizo'))).toEqual([
      { tipo: 'no_existe', origen: 'producto', indice: 0, producto: 'guacamole con chorizo' },
    ]);
  });

  it('si la derecha coincide con dos variantes, no adivina: "tiras de pollo con salsa"', () => {
    expect(separarVariantePegada(catalogo, 'tiras de pollo con salsa')).toBeNull();
    expect(aclaraciones(uno('tiras de pollo con salsa')).map((a) => a.tipo)).toEqual(['no_existe']);
  });

  it('la izquierda tiene que ser exacto un platillo: "pollo con salsa BBQ" no se resuelve', () => {
    expect(separarVariantePegada(catalogo, 'pollo con salsa BBQ')).toBeNull();
    expect(aclaraciones(uno('pollo con salsa BBQ')).map((a) => a.tipo)).toEqual(['no_existe']);
  });

  it('la derecha tiene que ser una variante: "tiras de pollo con papas" no se resuelve', () => {
    expect(aclaraciones(uno('tiras de pollo con papas')).map((a) => a.tipo)).toEqual(['no_existe']);
  });

  it('es solo un respaldo: un platillo cuyo nombre lleva "con" se encuentra como siempre', () => {
    expect(separarVariantePegada(catalogo, 'papa con chorizo')).toBeNull();
    expect(resumen(uno('papa con chorizo')).renglones).toEqual(['Papa con Chorizo']);
  });

  it('si además viene `variante`, no se parte: manda el campo', () => {
    expect(
      aclaraciones(uno('tiras de pollo con salsa BBQ', { variante: 'búfalo' })).map((a) => a.tipo),
    ).toEqual(['no_existe']);
  });

  it('devuelve el platillo y la variante oficiales', () => {
    const pegada = separarVariantePegada(catalogo, 'tiras de pollo con salsa bbq');
    expect(pegada?.platillo.nombre).toBe('Tiras de pollo');
    expect(pegada?.variante.nombre).toBe('Salsa BBQ');
  });
});

describe('variante mandada como extra suelto (D67)', () => {
  const tirasCon = (...extras: { extra: string; cantidad: number }[]) => ({
    productos: [{ producto: 'tiras de pollo', cantidad: 1 }],
    extrasSueltos: extras,
  });

  it.each(['BBQ', 'salsa BBQ', 'Salsa BBQ'])(
    'tiras de pollo sin variante + extra suelto "%s" → la variante es Salsa BBQ y el extra no se cobra',
    (extra) => {
      expect(resumen(tirasCon({ extra, cantidad: 1 }))).toEqual(TIRAS_BBQ);
    },
  );

  it('también si lo mandado como extra no existe como extra: "búfalo"', () => {
    expect(resumen(tirasCon({ extra: 'búfalo', cantidad: 1 }))).toEqual({
      renglones: ['Tiras de pollo (Salsa Búfalo)'],
      total: 18600,
    });
  });

  it('los demás extras sueltos se siguen cobrando', () => {
    expect(
      resumen(tirasCon({ extra: 'BBQ', cantidad: 1 }, { extra: 'totopos', cantidad: 1 })),
    ).toEqual({ renglones: ['Tiras de pollo (Salsa BBQ)', 'Totopos'], total: 18600 + 2000 });
  });

  it('si el cliente sí dijo la variante, el extra es un extra: se cobra aparte', () => {
    expect(
      resumen({
        productos: [{ producto: 'tiras de pollo', variante: 'búfalo', cantidad: 1 }],
        extrasSueltos: [{ extra: 'BBQ', cantidad: 1 }],
      }),
    ).toEqual({ renglones: ['Tiras de pollo (Salsa Búfalo)', 'BBQ'], total: 18600 + 1500 });
  });

  it('un platillo con una sola presentación no toma el extra: se cobra aparte', () => {
    expect(
      resumen({
        productos: [{ producto: 'guacamole', cantidad: 1 }],
        extrasSueltos: [{ extra: 'BBQ', cantidad: 1 }],
      }),
    ).toEqual({ renglones: ['Guacamole', 'BBQ'], total: 12300 + 1500 });
  });

  it('con cantidad distinta de 1 no adivina: pregunta la variante', () => {
    expect(aclaraciones(tirasCon({ extra: 'BBQ', cantidad: 2 }))).toEqual([
      {
        tipo: 'falta_variante',
        origen: 'producto',
        indice: 0,
        producto: 'tiras de pollo',
        opciones: SALSAS,
      },
    ]);
  });

  it('si dos extras son variantes del platillo, no adivina', () => {
    const tipos = aclaraciones(
      tirasCon({ extra: 'BBQ', cantidad: 1 }, { extra: 'búfalo', cantidad: 1 }),
    ).map((a) => `${a.origen}:${a.tipo}`);
    expect(tipos).toEqual(['producto:falta_variante', 'extraSuelto:no_existe']);
  });

  it('si el mismo extra le sirve a dos platillos, no adivina', () => {
    const args = CotizarPedidoArgsSchema.parse({
      productos: [
        { producto: 'tiras de pollo', cantidad: 1 },
        { producto: 'tiras de pollo', cantidad: 1 },
      ],
      extrasSueltos: [{ extra: 'BBQ', cantidad: 1 }],
    });
    expect(variantesEnExtras(catalogo, args).size).toBe(0);
    expect(aclaraciones(args).map((a) => `${a.indice}:${a.tipo}`)).toEqual([
      '0:falta_variante',
      '1:falta_variante',
    ]);
  });

  it('un extra que no es variante de ese platillo no cambia nada: sigue faltando la variante', () => {
    expect(
      aclaraciones({
        productos: [{ producto: 'limonada mineral', cantidad: 1 }],
        extrasSueltos: [{ extra: 'totopos', cantidad: 1 }],
      }).map((a) => a.tipo),
    ).toEqual(['falta_variante']);
  });

  it('dice qué extra era la variante de qué producto', () => {
    const args = CotizarPedidoArgsSchema.parse({
      productos: [
        { producto: 'guacamole', cantidad: 1 },
        { producto: 'tiras de pollo', cantidad: 1 },
      ],
      extrasSueltos: [
        { extra: 'totopos', cantidad: 1 },
        { extra: 'BBQ', cantidad: 1 },
      ],
    });
    const resueltas = variantesEnExtras(catalogo, args);
    expect([...resueltas.keys()]).toEqual([1]);
    expect(resueltas.get(1)).toMatchObject({ indiceExtra: 1, variante: { nombre: 'Salsa BBQ' } });
  });
});

describe('llamada sin platillos ni extras (D67)', () => {
  const VACIO = { ok: false, pedidoVacio: true, aclaraciones: [] };

  it.each([
    ['{}', {}],
    ['las dos listas vacías', { productos: [], extrasSueltos: [] }],
    ['las dos listas en null', { productos: null, extrasSueltos: null }],
  ])('con %s responde pedidoVacio, sin aclaraciones', (_caso, args) => {
    expect(cotizar(args)).toEqual(VACIO);
  });

  it('el sobre de Retell sin `args`, o con `args` en null, cuenta como pedido vacío', () => {
    for (const sobre of [{ name: 'cotizar_pedido' }, { name: 'cotizar_pedido', args: null }]) {
      expect(CotizarPedidoPeticionSchema.parse(sobre).args).toEqual({
        productos: [],
        extrasSueltos: [],
      });
    }
  });

  it('una respuesta con aclaraciones lleva pedidoVacio en falso', () => {
    expect(cotizar(uno('pizza de pepperoni'))).toMatchObject({ ok: false, pedidoVacio: false });
  });

  it('el contrato no acepta las dos cosas a la vez, ni ninguna', () => {
    const aclaracion = { tipo: 'no_existe', origen: 'producto', indice: 0, producto: 'pizza' };
    const conLasDos = { ok: false, pedidoVacio: true, aclaraciones: [aclaracion] };
    const sinNinguna = { ok: false, pedidoVacio: false, aclaraciones: [] };
    expect(RespuestaCotizarPedidoSchema.safeParse(conLasDos).success).toBe(false);
    expect(RespuestaCotizarPedidoSchema.safeParse(sinNinguna).success).toBe(false);
  });

  it('crear_pedido sigue exigiendo al menos un renglón', () => {
    expect(CrearPedidoArgsSchema.safeParse({ nombre: 'Ana', telefono: '6141234567' }).success).toBe(
      false,
    );
  });
});
