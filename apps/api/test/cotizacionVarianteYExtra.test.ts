import {
  CotizarPedidoArgsSchema,
  CrearPedidoArgsSchema,
  RespuestaCotizarPedidoSchema,
  RespuestaCrearPedidoSchema,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { armarCatalogo, cotizarPedido } from '../src/services/cotizacion';
import { armarMenu } from '../src/services/menu';
import { crearPedido } from '../src/services/pedido';
import { crearApp } from '../src/index';
import { crearRepoMenuEnMemoria } from './menuEnMemoria';
import { crearRepoPedidosEnMemoria } from './pedidosEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

/*
 * US-07-P2-T3 (D78), con el menú real del seed: la variante elegida y un extra que son lo mismo
 * ("Salsa BBQ" y el extra suelto "BBQ", $15) no se cobran doble en silencio. Se aclara con
 * `extra_igual_a_variante` y solo se cobra si vuelve con `porcionAparte`.
 */

const seed = leerSeedMenu();
const catalogo = armarCatalogo(armarMenu(seed.filas), seed.sinonimos);

const cotizar = (args: unknown) =>
  RespuestaCotizarPedidoSchema.parse(cotizarPedido(catalogo, CotizarPedidoArgsSchema.parse(args)));
function aclaraciones(args: unknown) {
  const respuesta = cotizar(args);
  if (respuesta.ok) throw new Error(`Se esperaban aclaraciones: ${JSON.stringify(respuesta)}`);
  return respuesta.aclaraciones;
}
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

const TIRAS = 18600;
const BBQ = 1500;
const tiras = (variante?: string, extra: Record<string, unknown> = {}) => ({
  producto: 'tiras de pollo',
  cantidad: 1,
  ...(variante === undefined ? {} : { variante }),
  ...extra,
});
const bbq = (extra: Record<string, unknown> = {}) => ({ extra: 'BBQ', cantidad: 1, ...extra });
const IGUAL_SUELTO = {
  tipo: 'extra_igual_a_variante',
  origen: 'extraSuelto',
  indice: 0,
  producto: 'BBQ',
  detalle: 'Salsa BBQ',
};

describe('variante y extra suelto que son lo mismo (D78)', () => {
  it.each(['Salsa BBQ', 'salsa bbq', 'BBQ'])(
    'variante "%s" + BBQ suelto → extra_igual_a_variante, nunca $201',
    (variante) => {
      expect(aclaraciones({ productos: [tiras(variante)], extrasSueltos: [bbq()] })).toEqual([
        IGUAL_SUELTO,
      ]);
    },
  );

  it.each(['salsa BBQ', 'Salsa BBQ'])('el extra suelto dicho como "%s" también', (extra) => {
    expect(
      aclaraciones({ productos: [tiras('Salsa BBQ')], extrasSueltos: [{ extra, cantidad: 1 }] }),
    ).toEqual([{ ...IGUAL_SUELTO, producto: extra }]);
  });

  it('con la variante pegada en producto (D67) + BBQ suelto → extra_igual_a_variante', () => {
    expect(
      aclaraciones({
        productos: [{ producto: 'tiras de pollo con salsa BBQ', cantidad: 1 }],
        extrasSueltos: [bbq()],
      }),
    ).toEqual([IGUAL_SUELTO]);
  });

  it('con porcionAparte: true se cobra la porción extra: $186 + $15', () => {
    expect(
      resumen({ productos: [tiras('Salsa BBQ')], extrasSueltos: [bbq({ porcionAparte: true })] }),
    ).toEqual({ renglones: ['Tiras de pollo (Salsa BBQ)', 'BBQ'], total: TIRAS + BBQ });
  });

  it.each([false, null])('porcionAparte en %s cuenta como que no la confirmó', (porcionAparte) => {
    expect(
      aclaraciones({ productos: [tiras('Salsa BBQ')], extrasSueltos: [bbq({ porcionAparte })] }),
    ).toEqual([IGUAL_SUELTO]);
  });

  it('sin el extra, solo las tiras: $186', () => {
    expect(resumen({ productos: [tiras('Salsa BBQ')] })).toEqual({
      renglones: ['Tiras de pollo (Salsa BBQ)'],
      total: TIRAS,
    });
  });

  it('se junta con las demás aclaraciones y no cotiza una parte del pedido', () => {
    expect(
      aclaraciones({
        productos: [tiras('Salsa BBQ'), { producto: 'sushi', cantidad: 1 }],
        extrasSueltos: [bbq({ cantidad: 30 })],
      }).map((a) => `${a.origen}:${a.tipo}`),
    ).toEqual([
      'producto:no_existe',
      'extraSuelto:extra_igual_a_variante',
      'extraSuelto:cantidad_invalida',
    ]);
  });

  it('otro extra suelto en el mismo pedido no se aclara', () => {
    expect(
      aclaraciones({
        productos: [tiras('Salsa BBQ')],
        extrasSueltos: [{ extra: 'totopos', cantidad: 1 }, bbq()],
      }),
    ).toEqual([{ ...IGUAL_SUELTO, indice: 1 }]);
  });
});

describe('secuencia con #69 (D67): sin variante sigue siendo falta_variante', () => {
  it('1ª sin variante + BBQ suelto → falta_variante; 2ª con Salsa BBQ y el BBQ todavía → extra_igual_a_variante', () => {
    expect(aclaraciones({ productos: [tiras()], extrasSueltos: [bbq()] })).toEqual([
      {
        tipo: 'falta_variante',
        origen: 'producto',
        indice: 0,
        producto: 'tiras de pollo',
        opciones: ['Salsa Búfalo', 'Salsa BBQ'],
      },
    ]);
    const segunda = cotizar({ productos: [tiras('Salsa BBQ')], extrasSueltos: [bbq()] });
    expect(segunda).toEqual({ ok: false, pedidoVacio: false, aclaraciones: [IGUAL_SUELTO] });
  });
});

describe('extra del platillo que es su variante (D78)', () => {
  it('BBQ en extras de las tiras con Salsa BBQ → extra_igual_a_variante con origen producto', () => {
    expect(aclaraciones({ productos: [tiras('Salsa BBQ', { extras: [bbq()] })] })).toEqual([
      {
        tipo: 'extra_igual_a_variante',
        origen: 'producto',
        indice: 0,
        producto: 'tiras de pollo',
        detalle: 'Salsa BBQ',
      },
    ]);
  });

  it('con porcionAparte vuelve a la regla de siempre: BBQ no está ligado a las tiras', () => {
    expect(
      aclaraciones({ productos: [tiras('Salsa BBQ', { extras: [bbq({ porcionAparte: true })] })] }),
    ).toEqual([
      {
        tipo: 'extra_no_permitido',
        origen: 'producto',
        indice: 0,
        producto: 'tiras de pollo',
        detalle: 'BBQ',
      },
    ]);
  });

  it('"Camarón" de los tacos capeados nombra a Espuelas, pero no van con los tacos: extra_no_permitido', () => {
    const productos = [
      {
        producto: 'tacos capeados',
        variante: 'camarón',
        cantidad: 1,
        extras: [{ extra: 'espuelas', cantidad: 1 }],
      },
    ];
    expect(aclaraciones({ productos }).map((a) => a.tipo)).toEqual(['extra_no_permitido']);
  });
});

describe('porcionAparte donde no hay choque (D78)', () => {
  it('variante que no es un extra (Salsa Búfalo) + BBQ: se cobran los dos, con o sin porcionAparte', () => {
    const esperado = { renglones: ['Tiras de pollo (Salsa Búfalo)', 'BBQ'], total: TIRAS + BBQ };
    expect(resumen({ productos: [tiras('Salsa Búfalo')], extrasSueltos: [bbq()] })).toEqual(
      esperado,
    );
    expect(
      resumen({
        productos: [tiras('Salsa Búfalo')],
        extrasSueltos: [bbq({ porcionAparte: true })],
      }),
    ).toEqual(esperado);
  });

  it('porcionAparte en un extra que no choca no cambia el total', () => {
    const sin = resumen({
      productos: [{ producto: 'guacamole', cantidad: 1 }],
      extrasSueltos: [{ extra: 'totopos', cantidad: 2 }],
    });
    const con = resumen({
      productos: [{ producto: 'guacamole', cantidad: 1 }],
      extrasSueltos: [{ extra: 'totopos', cantidad: 2, porcionAparte: true }],
    });
    expect(con).toEqual(sin);
    expect(con.total).toBe(12300 + 2000 * 2);
  });

  it('porcionAparte en las espuelas de un corte no cambia el total', () => {
    const corte = (extra: Record<string, unknown>) => ({
      productos: [
        { producto: 't-bone', cantidad: 1, extras: [{ extra: 'espuelas', cantidad: 1, ...extra }] },
      ],
    });
    expect(resumen(corte({ porcionAparte: true }))).toEqual(resumen(corte({})));
  });
});

describe('crear_pedido con los mismos args que la última cotización (D49)', () => {
  const repoMenu = crearRepoMenuEnMemoria(seed.filas, seed.sinonimos);
  const CONFIRMADO = [
    { role: 'agent', content: '¿Confirmo tu pedido a nombre de María José por $201.00?' },
    { role: 'user', content: 'Sí' },
  ];
  const crear = async (extrasSueltos: unknown[]) =>
    RespuestaCrearPedidoSchema.parse(
      await crearPedido(
        repoMenu,
        crearRepoPedidosEnMemoria(),
        CrearPedidoArgsSchema.parse({
          productos: [tiras('Salsa BBQ')],
          extrasSueltos,
          nombre: 'María José',
          telefono: '614 123 4567',
        }),
        CONFIRMADO,
      ),
    );

  it('con porcionAparte guarda las tiras y la BBQ: $201', async () => {
    expect(await crear([bbq({ porcionAparte: true })])).toMatchObject({
      ok: true,
      totalCentavos: TIRAS + BBQ,
    });
  });

  it('sin porcionAparte no guarda y responde la aclaración', async () => {
    expect(await crear([bbq()])).toMatchObject({ ok: false, aclaraciones: [IGUAL_SUELTO] });
  });
});

describe('contrato en /openapi.json', () => {
  it('trae el tipo de aclaración nuevo y porcionAparte en los extras', async () => {
    const app = crearApp({ crearRepoMenu: () => repoMenuSeed() });
    const texto = await (await app.request('/openapi.json')).text();
    expect(texto).toContain('extra_igual_a_variante');
    expect(texto).toContain('porcionAparte');
  });
});

function repoMenuSeed() {
  return crearRepoMenuEnMemoria(seed.filas, seed.sinonimos);
}
