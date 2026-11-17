import {
  CotizarPedidoArgsSchema,
  CotizarPedidoPeticionSchema,
  CrearPedidoArgsSchema,
  RespuestaCotizarPedidoSchema,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { armarCatalogo, cotizarPedido, separarVariantePegada } from '../src/services/cotizacion';
import { armarMenu } from '../src/services/menu';
import { leerSeedMenu } from './seedEnMemoria';

/*
 * US-07-P2-T2 (D67), con el menú real del seed: la variante que el modelo no manda en su campo
 * (pegada en `producto` con "con") y la llamada sin ningún platillo. Mandada como extra suelto no
 * se adivina: decisión del PO en la revisión del #69.
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

  it("la variante cuyo nombre ya empieza con 'con': 'taquiza sirloin con frijoles charros'", () => {
    expect(resumen(uno('taquiza sirloin con frijoles charros'))).toEqual({
      renglones: ['Taquiza Sirloin (Con frijoles charros)'],
      total: 60900,
    });
  });

  it("'fajitas de pollo con arroz' no se parte: el arroz no es una presentación de las fajitas", () => {
    expect(separarVariantePegada(catalogo, 'fajitas de pollo con arroz')).toBeNull();
    expect(aclaraciones(uno('fajitas de pollo con arroz')).map((a) => a.tipo)).toEqual([
      'no_existe',
    ]);
  });

  it("'hamburguesa con tocino' no se parte: se pregunta como siempre", () => {
    expect(separarVariantePegada(catalogo, 'hamburguesa con tocino')).toBeNull();
    expect(aclaraciones(uno('hamburguesa con tocino'))).toMatchObject([
      { tipo: 'ambiguo', opciones: ['Hamburguesa Delicias Tocino'] },
    ]);
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

describe('la variante mandada como extra suelto no se adivina (D67)', () => {
  const tirasCon = (...extras: { extra: string; cantidad: number }[]) => ({
    productos: [{ producto: 'tiras de pollo', cantidad: 1 }],
    extrasSueltos: extras,
  });
  const FALTA_SALSA = {
    tipo: 'falta_variante',
    origen: 'producto',
    indice: 0,
    producto: 'tiras de pollo',
    opciones: SALSAS,
  };

  // La BBQ también se vende suelta y se cobra aparte (D19): el backend no elige por el cliente.
  it.each(['BBQ', 'salsa BBQ', 'Salsa BBQ'])(
    "tiras de pollo sin variante + extra suelto '%s' → falta_variante, sin elegir la salsa",
    (extra) => {
      expect(aclaraciones(tirasCon({ extra, cantidad: 1 }))).toEqual([FALTA_SALSA]);
    },
  );

  it('ya con la variante, la BBQ suelta se cobra como extra', () => {
    expect(
      resumen({
        productos: [{ producto: 'tiras de pollo', variante: 'Salsa BBQ', cantidad: 1 }],
        extrasSueltos: [{ extra: 'BBQ', cantidad: 1 }],
      }),
    ).toEqual({ renglones: ['Tiras de pollo (Salsa BBQ)', 'BBQ'], total: 18600 + 1500 });
  });

  it("una variante que no es extra ('búfalo') mandada como extra suelto: falta la variante y el extra no existe", () => {
    const tipos = aclaraciones(tirasCon({ extra: 'búfalo', cantidad: 1 })).map(
      (a) => `${a.origen}:${a.tipo}`,
    );
    expect(tipos).toEqual(['producto:falta_variante', 'extraSuelto:no_existe']);
  });

  it('si el cliente sí dijo la variante, el extra es un extra: se cobra aparte', () => {
    expect(
      resumen({
        productos: [{ producto: 'tiras de pollo', variante: 'búfalo', cantidad: 1 }],
        extrasSueltos: [{ extra: 'BBQ', cantidad: 1 }],
      }),
    ).toEqual({ renglones: ['Tiras de pollo (Salsa Búfalo)', 'BBQ'], total: 18600 + 1500 });
  });

  it('un platillo con una sola presentación y un extra suelto: los dos se cobran', () => {
    expect(
      resumen({
        productos: [{ producto: 'guacamole', cantidad: 1 }],
        extrasSueltos: [{ extra: 'BBQ', cantidad: 1 }],
      }),
    ).toEqual({ renglones: ['Guacamole', 'BBQ'], total: 12300 + 1500 });
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
