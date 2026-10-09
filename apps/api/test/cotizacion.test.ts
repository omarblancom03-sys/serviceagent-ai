import { CotizarPedidoArgsSchema, RespuestaCotizarPedidoSchema } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { palabras } from '../src/lib/normalizar';
import {
  armarCatalogo,
  buscarPorPalabras,
  cotizarPedido,
  DETALLE_CANTIDAD,
  MAX_OPCIONES,
  obtenerCotizacion,
  resolverPlatillo,
  type Catalogo,
  type ResultadoPlatillo,
} from '../src/services/cotizacion';
import { armarMenu, type FilasMenu } from '../src/services/menu';
import { crearRepoMenuEnMemoria, filasMenuDePrueba, repoMenuQueFalla } from './menuEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

// Removibles DE PRUEBA (el seed aún no trae, D29): Guacamole → Cebolla, Cilantro.
const seed = leerSeedMenu({
  removibles: [
    { platillo: 'Guacamole', nombre: 'Cebolla' },
    { platillo: 'Guacamole', nombre: 'Cilantro' },
  ],
});
const catalogo = armarCatalogo(armarMenu(seed.filas), seed.sinonimos);
const buscar = (texto: string) => resolverPlatillo(catalogo, texto);

/** Resultado en forma corta para comparar: el nombre si se encontró, si no el tipo y las opciones. */
const resumen = (resultado: ResultadoPlatillo) =>
  resultado.tipo === 'encontrado' ? resultado.platillo.nombre : resultado;

const GRANEROS = [
  'Ensalada Granero',
  'Taquiza Granero',
  'Caldo Granero',
  'Platillo Granero',
  'Hamburguesa Granero',
  'El Granero',
  'Caldito Granero',
];
const PAPAS = [
  'Papas francesas',
  'Papa Natural',
  'Papa con Elote',
  'Papa con Champiñón',
  'Papa con Chorizo',
  'Papa con Tocino',
  'Papa con Arrachera',
  'Papa Luiggi Especial',
];
// Caldo Granero ya no aparece: su "pollo" estaba en el sinónimo retirado "caldo de pollo" (D27).
const POLLOS = [
  'Ensalada Granero',
  'Fajitas de pollo',
  'Tiras de pollo',
  'Hamburguesa de Pollo',
  'Fajitas de pollo infantil',
];

describe('resolverPlatillo sobre el seed real', () => {
  /*
   * Sinónimos genéricos retirados (D27): caen al paso 2 y se preguntan. "una" y "la" son
   * relleno, así que "una granero" y "la granero" dan lo mismo que "granero".
   */
  it.each([
    ['alambre', ['Taquiza Alambre', 'Pizerola de Alambre']],
    [
      'costillas',
      ['Costillas Chihuahua', 'Costillas 450 gr', 'Costillas BBQ 450 gr', 'Costillas a la Diabla'],
    ],
    ['queso', ['Rajas con queso', 'Queso fundido', 'Luiggi Especial']],
    ['filete de pescado', ['Filete de pescado empanizado', 'Filete de pescado infantil']],
    ['delicias', ['Hamburguesa Delicias', 'Hamburguesa Delicias Tocino', 'Taco Delicias']],
    ['luiggi', ['Luiggi Especial', 'Papa Luiggi Especial']],
    ['granero', GRANEROS],
    ['una granero', GRANEROS],
    ['la granero', GRANEROS],
    ['pollo', POLLOS],
    ['una de pollo', POLLOS],
    ['papa', PAPAS],
    ['papas', PAPAS],
    // "orden de papas" no está en el seed: da lo mismo que "papas". Si el PO aprueba el sinónimo
    // 'orden de papas' → Papas francesas, el PR B3 lo agrega y cambia este caso.
    ['orden de papas', PAPAS],
    [
      'fajitas',
      [
        'Fajitas de arrachera',
        'Fajitas Trío',
        'Fajitas de pollo',
        'Fajitas de pollo infantil',
        'Fajitas de arrachera infantil',
      ],
    ],
  ])('"%s" → ambiguo con sus opciones en el orden del menú', (texto, opciones) => {
    expect(buscar(texto)).toEqual({ tipo: 'ambiguo', opciones });
  });

  it.each([
    // Nombre exacto: el artículo de "El Granero" es parte del nombre.
    ['el granero', 'El Granero'],
    ['hamburguesa granero', 'Hamburguesa Granero'],
    ['papas francesas', 'Papas francesas'],
    ['Arrachera al Chipotle 450 gr', 'Arrachera al Chipotle 450 gr'],
    // Excepciones de D27: el PO mantiene estos sinónimos de una palabra a propósito. "arrachera"
    // y "sirloin" aparecen en otros platillos, pero los cortes se piden así.
    ['arrachera', 'Arrachera 450 gr'],
    ['sirloin', 'Sirloin 450 gr'],
    ['elote', 'Elote amarillo'],
    ['agua', 'Agua natural 500 ml'],
    ['frijoles', 'Frijoles charros'],
    ['t-bone', 'T-Bone 450 gr'],
    ['hamburguesas algodoneros', 'Hamburguesa Algodoneros'],
    // Nivel sin relleno: el relleno es del cliente, el texto de la base no tenía.
    ['un guacamole', 'Guacamole'],
    ['dame un cowboy', 'Cowboy 450 gr'],
    ['una orden de salchichas', 'Orden de salchichas'],
    ['una papa con chorizo', 'Papa con Chorizo'],
    ['quiero la hamburguesa granero', 'Hamburguesa Granero'],
  ])('"%s" → %s', (texto, nombre) => {
    expect(resumen(buscar(texto))).toBe(nombre);
  });

  it.each([
    ['la de chipotle', 'Arrachera al Chipotle 450 gr'],
    ['chipotle', 'Arrachera al Chipotle 450 gr'],
    // "La Boquilla" sin su artículo es una sola palabra: no entra al nivel sin relleno.
    ['boquilla', 'La Boquilla'],
    // Sinónimos retirados (D27) que hoy solo encuentran un platillo con esas palabras: los otros
    // postres no dicen "postre", el tocino de la Hamburguesa Granero está en la descripción y la
    // única "fajitas … niño" que queda es la de arrachera.
    ['postre', 'Postre del día'],
    ['hamburguesa con tocino', 'Hamburguesa Delicias Tocino'],
    ['fajitas niño', 'Fajitas de arrachera infantil'],
  ])('una coincidencia parcial se pregunta aunque sea una: "%s"', (texto, opcion) => {
    expect(buscar(texto)).toEqual({ tipo: 'ambiguo', opciones: [opcion] });
  });

  it.each([
    ['pizza de pepperoni'],
    // D28: el menú no registra marcas.
    ['coca'],
    // Sinónimo retirado (D27): ningún nombre ni sinónimo que queda dice "caldo" y "pollo".
    ['caldo de pollo'],
    // Los números no son relleno (decisión del PO): la cantidad va aparte y la separa el agente.
    ['dos tacos rancheros'],
    // Texto que queda vacío al normalizar: no se busca.
    ['???'],
    ['la de'],
    ['una orden de'],
  ])('"%s" → no_existe', (texto) => {
    expect(buscar(texto)).toEqual({ tipo: 'no_existe' });
  });

  it('reenviar cualquier nombre oficial (lo que va en `opciones`) lo resuelve directo', () => {
    expect(catalogo.platillos).toHaveLength(95);
    for (const platillo of catalogo.platillos) {
      expect(resumen(buscar(platillo.nombre)), platillo.nombre).toBe(platillo.nombre);
    }
  });

  it(`ningún nombre ni sinónimo del seed da más de ${MAX_OPCIONES} opciones en el paso 2`, () => {
    const textos = [
      ...catalogo.platillos.map((p) => p.nombre),
      ...seed.sinonimos.map((s) => s.frase),
    ];
    for (const texto of textos) {
      expect(buscarPorPalabras(catalogo, palabras(texto)).length, texto).toBeLessThanOrEqual(
        MAX_OPCIONES,
      );
    }
  });

  it('ninguna llave exacta lleva a dos platillos', () => {
    for (const indice of [catalogo.indiceSuave, catalogo.indiceSinRelleno]) {
      const repetidas = [...indice].filter(([, ids]) => ids.length > 1).map(([llave]) => llave);
      expect(repetidas).toEqual([]);
    }
  });

  it('los textos genéricos de la base no entran al índice sin relleno', () => {
    // "El Granero" y "La Boquilla" sin artículo quedan en una palabra: no entran.
    for (const llave of ['granero', 'boquilla']) {
      expect(catalogo.indiceSinRelleno.has(llave), llave).toBe(false);
    }
    // "Orden de salchichas" tampoco, pero el sinónimo "salchichas" sí: no tenía relleno.
    expect(catalogo.indiceSinRelleno.get('salchicha')).toHaveLength(1);
  });
});

describe('resolverPlatillo con un menú de prueba', () => {
  const sinonimo = (idPlatillo: number, frase: string, activo = true) => ({
    idPlatillo,
    frase,
    activo,
  });

  it('ignora sinónimos inactivos, de platillos que no aparecen o de puro relleno', () => {
    // Platillo 4 está inactivo y el 6 está en una categoría inactiva (menuEnMemoria.ts).
    const dePrueba = armarCatalogo(armarMenu(filasMenuDePrueba()), [
      sinonimo(1, 'guaca'),
      sinonimo(1, 'aguacatito', false),
      sinonimo(4, 'dado de baja'),
      sinonimo(6, 'ponchecito'),
      sinonimo(3, 'la de'),
    ]);
    expect(resumen(resolverPlatillo(dePrueba, 'guaca'))).toBe('Guacamole');
    for (const texto of ['aguacatito', 'dado de baja', 'ponchecito', 'Platillo dado de baja']) {
      expect(resolverPlatillo(dePrueba, texto), texto).toEqual({ tipo: 'no_existe' });
    }
  });

  it('una llave exacta que lleva a dos platillos da ambiguo con los dos, en el orden del menú', () => {
    // El seed real no tiene este caso (lo cuida otro test); aquí se fuerza con un sinónimo repetido.
    const dePrueba = armarCatalogo(armarMenu(filasMenuDePrueba()), [
      sinonimo(3, 'tacos de la casa'),
      sinonimo(1, 'tacos de la casa'),
    ]);
    expect(dePrueba.indiceSuave.get('taco de la casa')).toEqual([3, 1]);
    expect(resolverPlatillo(dePrueba, 'tacos de la casa')).toEqual({
      tipo: 'ambiguo',
      opciones: ['Guacamole', 'Queso fundido'],
    });
    // Mismo resultado por el nivel sin relleno ("taco casa").
    expect(dePrueba.indiceSinRelleno.get('taco casa')).toEqual([3, 1]);
    expect(resolverPlatillo(dePrueba, 'unos tacos de la casa')).toEqual({
      tipo: 'ambiguo',
      opciones: ['Guacamole', 'Queso fundido'],
    });
  });

  it(`corta las opciones en ${MAX_OPCIONES}, en el orden del menú`, () => {
    const filas: FilasMenu = {
      ...filasMenuDePrueba(),
      platillos: Array.from({ length: 15 }, (_, i) => ({
        id: 100 - i, // desordenados a propósito
        idCategoria: 1,
        nombre: `Taco ${100 - i}`,
        descripcion: '',
        imagen: null,
        tiempoEstimadoMin: null,
        activo: true,
      })),
      variantes: Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        idPlatillo: 100 - i,
        nombre: 'Único',
        precioCentavos: 1000,
        descripcion: null,
        activo: true,
      })),
    };
    const resultado = resolverPlatillo(armarCatalogo(armarMenu(filas), []), 'taco');
    expect(resultado).toEqual({
      tipo: 'ambiguo',
      opciones: Array.from({ length: MAX_OPCIONES }, (_, i) => `Taco ${86 + i}`),
    });
  });
});

/*
 * Cálculo de la cotización con el menú real. La petición pasa por el mismo esquema que usará la
 * ruta (defaults incluidos) y la respuesta se valida contra el contrato.
 */
function cotizarCon(catalogoUsado: Catalogo, args: unknown) {
  return RespuestaCotizarPedidoSchema.parse(
    cotizarPedido(catalogoUsado, CotizarPedidoArgsSchema.parse(args)),
  );
}
const cotizar = (args: unknown) => cotizarCon(catalogo, args);
const uno = (producto: string, extra: Record<string, unknown> = {}) => ({
  productos: [{ producto, cantidad: 1, ...extra }],
});
/** Total de una cotización que debe salir bien. */
function total(args: unknown) {
  const respuesta = cotizar(args);
  if (!respuesta.ok) throw new Error(`Se esperaba ok: ${JSON.stringify(respuesta.aclaraciones)}`);
  return respuesta.totalCentavos;
}
/** Aclaraciones de una cotización que debe pedirlas. */
function aclaraciones(args: unknown) {
  const respuesta = cotizar(args);
  if (respuesta.ok) throw new Error(`Se esperaban aclaraciones: ${JSON.stringify(respuesta)}`);
  return respuesta.aclaraciones;
}

const LIMONADAS = ['Vaso 500 ml', 'Frasco 1 L', 'Jarra 2000 ml'];
const espuelas = (cantidad: number) => ({ extras: [{ extra: 'espuelas', cantidad }] });

describe('cotizarPedido: los 14 casos acordados', () => {
  it('1. Hamburguesa Granero + refresco → $188.00', () => {
    const respuesta = cotizar({
      productos: [
        { producto: 'hamburguesa granero', cantidad: 1 },
        { producto: 'refresco', cantidad: 1 },
      ],
    });
    expect(respuesta).toMatchObject({ ok: true, totalCentavos: 18800, totalTexto: '$188.00' });
  });

  it('2. dos T-Bone con 1 Espuelas cada uno → (40300 + 5500) × 2 = 91600', () => {
    expect(cotizar({ productos: [{ producto: 't-bone', cantidad: 2, ...espuelas(1) }] })).toEqual({
      ok: true,
      renglones: [
        {
          tipo: 'platillo',
          indice: 0,
          idPlatillo: expect.any(Number),
          nombre: 'T-Bone 450 gr',
          idVariante: expect.any(Number),
          variante: null,
          cantidad: 2,
          sinIngredientes: [],
          extras: [
            {
              idExtra: expect.any(Number),
              nombre: 'Espuelas (camarones)',
              cantidad: 1,
              precioUnitarioCentavos: 5500,
              precioUnitarioTexto: '$55.00',
            },
          ],
          precioUnitarioCentavos: 40300,
          precioUnitarioTexto: '$403.00',
          subtotalCentavos: 91600,
          subtotalTexto: '$916.00',
        },
      ],
      totalCentavos: 91600,
      totalTexto: '$916.00',
    });
  });

  it('3. Cowboy → 46900', () => {
    expect(total(uno('cowboy'))).toBe(46900);
  });

  it('4. Limonada natural sin variante → falta_variante con sus 3 presentaciones', () => {
    expect(aclaraciones(uno('limonada natural'))).toEqual([
      {
        tipo: 'falta_variante',
        origen: 'producto',
        indice: 0,
        producto: 'limonada natural',
        opciones: LIMONADAS,
      },
    ]);
  });

  it('5. pizza de pepperoni → no_existe', () => {
    expect(aclaraciones(uno('pizza de pepperoni'))).toEqual([
      { tipo: 'no_existe', origen: 'producto', indice: 0, producto: 'pizza de pepperoni' },
    ]);
  });

  it('6. Hawaiana con Espuelas → extra_no_permitido (solo van con sus cortes)', () => {
    expect(aclaraciones(uno('hawaiana', espuelas(1)))).toEqual([
      {
        tipo: 'extra_no_permitido',
        origen: 'producto',
        indice: 0,
        producto: 'hawaiana',
        detalle: 'espuelas',
      },
    ]);
  });

  it('7. Guacamole sin aguacate → ingrediente_no_removible', () => {
    expect(aclaraciones(uno('guacamole', { sinIngredientes: ['aguacate'] }))).toEqual([
      {
        tipo: 'ingrediente_no_removible',
        origen: 'producto',
        indice: 0,
        producto: 'guacamole',
        detalle: 'aguacate',
      },
    ]);
  });

  it('8. 25 Algodoneros → cantidad_invalida', () => {
    expect(aclaraciones({ productos: [{ producto: 'algodoneros', cantidad: 25 }] })).toEqual([
      {
        tipo: 'cantidad_invalida',
        origen: 'producto',
        indice: 0,
        producto: 'algodoneros',
        detalle: DETALLE_CANTIDAD,
      },
    ]);
  });

  it('9. Totopos + Aguacate sueltos → 2000 + 2500 = 4500', () => {
    const respuesta = cotizar({
      extrasSueltos: [
        { extra: 'totopos', cantidad: 1 },
        { extra: 'aguacate', cantidad: 1 },
      ],
    });
    expect(respuesta).toMatchObject({
      ok: true,
      renglones: [
        { tipo: 'extra', indice: 0, nombre: 'Totopos', subtotalCentavos: 2000 },
        { tipo: 'extra', indice: 1, nombre: 'Aguacate', subtotalCentavos: 2500 },
      ],
      totalCentavos: 4500,
    });
  });

  it('10. Limonada mineral + pepperoni → las 2 aclaraciones juntas; con "vaso" → 4900', () => {
    expect(
      aclaraciones({
        productos: [
          { producto: 'limonada mineral', cantidad: 1 },
          { producto: 'pizza de pepperoni', cantidad: 1 },
        ],
      }),
    ).toEqual([
      {
        tipo: 'falta_variante',
        origen: 'producto',
        indice: 0,
        producto: 'limonada mineral',
        opciones: LIMONADAS,
      },
      { tipo: 'no_existe', origen: 'producto', indice: 1, producto: 'pizza de pepperoni' },
    ]);

    expect(cotizar(uno('limonada mineral', { variante: 'vaso' }))).toMatchObject({
      ok: true,
      renglones: [{ variante: 'Vaso 500 ml', subtotalCentavos: 4900 }],
      totalCentavos: 4900,
    });
  });

  it('11. Rib Eye → 47300 y "$473.00"', () => {
    expect(cotizar(uno('rib eye'))).toMatchObject({
      ok: true,
      totalCentavos: 47300,
      totalTexto: '$473.00',
    });
  });

  it('12. fajitas → ambiguo con las 5 fajitas', () => {
    expect(aclaraciones(uno('fajitas'))).toEqual([
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
    ]);
  });

  it.each(['chipotle', 'la de chipotle'])('13 y 14. "%s" → ambiguo con 1 opción', (texto) => {
    expect(aclaraciones(uno(texto))).toEqual([
      {
        tipo: 'ambiguo',
        origen: 'producto',
        indice: 0,
        producto: texto,
        opciones: ['Arrachera al Chipotle 450 gr'],
      },
    ]);
  });

  it('14. reenviar el nombre que vino en `opciones` se cotiza directo → 47300', () => {
    expect(total(uno('Arrachera al Chipotle 450 gr'))).toBe(47300);
  });
});

describe('cotizarPedido: extras', () => {
  it('Espuelas con cantidad 2 en un T-Bone → 40300 + 2 × 5500 = 51300 (D30)', () => {
    expect(total(uno('t-bone', espuelas(2)))).toBe(51300);
  });

  it('Espuelas suelta → extra_no_permitido con origen extraSuelto', () => {
    expect(aclaraciones({ extrasSueltos: [{ extra: 'espuelas', cantidad: 1 }] })).toEqual([
      {
        tipo: 'extra_no_permitido',
        origen: 'extraSuelto',
        indice: 0,
        producto: 'espuelas',
        detalle: 'espuelas',
      },
    ]);
  });

  it('un extra suelto que no existe → no_existe con origen extraSuelto', () => {
    expect(aclaraciones({ extrasSueltos: [{ extra: 'queso extra', cantidad: 1 }] })).toEqual([
      { tipo: 'no_existe', origen: 'extraSuelto', indice: 0, producto: 'queso extra' },
    ]);
  });

  it('un extra que no existe dentro de un platillo → extra_no_permitido con el extra', () => {
    const pedido = uno('t-bone', { extras: [{ extra: 'chimichurri', cantidad: 1 }] });
    expect(aclaraciones(pedido)).toEqual([
      {
        tipo: 'extra_no_permitido',
        origen: 'producto',
        indice: 0,
        producto: 't-bone',
        detalle: 'chimichurri',
      },
    ]);
  });

  it('un extra suelto (Aguacate) dentro de un platillo → extra_no_permitido', () => {
    const pedido = uno('guacamole', { extras: [{ extra: 'aguacate', cantidad: 1 }] });
    expect(aclaraciones(pedido)).toEqual([
      expect.objectContaining({ tipo: 'extra_no_permitido', detalle: 'aguacate' }),
    ]);
  });
});

describe('cotizarPedido: cantidades (enteras de 1 a 20, D30)', () => {
  const invalida = (origen: 'producto' | 'extraSuelto', producto: string) => ({
    tipo: 'cantidad_invalida',
    origen,
    indice: 0,
    producto,
    detalle: DETALLE_CANTIDAD,
  });

  it.each([0, 1.5, 21])('%s en el platillo → cantidad_invalida', (cantidad) => {
    expect(aclaraciones({ productos: [{ producto: 'cowboy', cantidad }] })).toEqual([
      invalida('producto', 'cowboy'),
    ]);
  });

  it.each([0, 1.5, 21])('%s en el extra de un platillo → cantidad_invalida del platillo', (n) => {
    expect(aclaraciones(uno('t-bone', espuelas(n)))).toEqual([invalida('producto', 't-bone')]);
  });

  it.each([0, 1.5, 21])('%s en un extra suelto → cantidad_invalida', (cantidad) => {
    expect(aclaraciones({ extrasSueltos: [{ extra: 'totopos', cantidad }] })).toEqual([
      invalida('extraSuelto', 'totopos'),
    ]);
  });

  it('acepta los límites 1 y 20', () => {
    expect(total({ productos: [{ producto: 'cowboy', cantidad: 20 }] })).toBe(46900 * 20);
    expect(total({ extrasSueltos: [{ extra: 'totopos', cantidad: 20 }] })).toBe(2000 * 20);
  });
});

describe('cotizarPedido: variantes', () => {
  it('sin variante y con una sola "Único" → se usa y sale variante null', () => {
    expect(cotizar(uno('guacamole'))).toMatchObject({
      ok: true,
      renglones: [{ nombre: 'Guacamole', variante: null, subtotalCentavos: 12300 }],
    });
  });

  it('con una sola variante, pedir "único" coincide', () => {
    expect(total(uno('guacamole', { variante: 'único' }))).toBe(12300);
  });

  it('con una sola variante, una variante que no coincide → falta_variante con esa opción', () => {
    expect(aclaraciones(uno('guacamole', { variante: 'grande' }))).toEqual([
      {
        tipo: 'falta_variante',
        origen: 'producto',
        indice: 0,
        producto: 'guacamole',
        detalle: 'grande',
        opciones: ['Único'],
      },
    ]);
  });

  it('la variante que contiene las palabras pedidas se elige: "charros"', () => {
    expect(cotizar(uno('taquiza sirloin', { variante: 'charros' }))).toMatchObject({
      ok: true,
      renglones: [{ variante: 'Con frijoles charros', subtotalCentavos: 60900 }],
    });
  });

  it('si las palabras están en varias variantes → falta_variante con lo pedido', () => {
    expect(aclaraciones(uno('taquiza sirloin', { variante: 'frijoles' }))).toEqual([
      {
        tipo: 'falta_variante',
        origen: 'producto',
        indice: 0,
        producto: 'taquiza sirloin',
        detalle: 'frijoles',
        opciones: ['Con frijoles charros', 'Con frijoles refritos'],
      },
    ]);
  });
});

describe('cotizarPedido: ingredientes y reglas generales', () => {
  it('quitar un ingrediente removible → el renglón lo lleva con su nombre oficial', () => {
    expect(cotizar(uno('guacamole', { sinIngredientes: ['cebolla'] }))).toMatchObject({
      ok: true,
      renglones: [{ sinIngredientes: ['Cebolla'], subtotalCentavos: 12300 }],
    });
  });

  it('un platillo inactivo → no_existe', () => {
    const dePrueba = armarCatalogo(armarMenu(filasMenuDePrueba()), []);
    expect(cotizarCon(dePrueba, uno('Platillo dado de baja'))).toEqual({
      ok: false,
      aclaraciones: [
        { tipo: 'no_existe', origen: 'producto', indice: 0, producto: 'Platillo dado de baja' },
      ],
    });
  });

  it('junta todas las aclaraciones de un pedido, cada una con su origen e índice', () => {
    const resultado = aclaraciones({
      productos: [
        { producto: 'cowboy', cantidad: 1 },
        { producto: 'guacamole', cantidad: 0, sinIngredientes: ['aguacate'] },
        { producto: 'hawaiana', cantidad: 1, ...espuelas(1) },
      ],
      extrasSueltos: [
        { extra: 'espuelas', cantidad: 1 },
        { extra: 'queso extra', cantidad: 1 },
      ],
    });
    expect(resultado.map(({ tipo, origen, indice }) => `${origen}[${indice}] ${tipo}`)).toEqual([
      'producto[1] cantidad_invalida',
      'producto[1] ingrediente_no_removible',
      'producto[2] extra_no_permitido',
      'extraSuelto[0] extra_no_permitido',
      'extraSuelto[1] no_existe',
    ]);
  });

  it('platillos y extras sueltos juntos: renglones en el orden pedido y total en centavos', () => {
    expect(
      cotizar({
        productos: [
          { producto: 'rib eye', cantidad: 1, ...espuelas(1) },
          { producto: 'limonada natural', variante: 'jarra', cantidad: 2 },
        ],
        extrasSueltos: [{ extra: 'toreados', cantidad: 3 }],
      }),
    ).toMatchObject({
      ok: true,
      renglones: [
        { tipo: 'platillo', indice: 0, subtotalCentavos: 47300 + 5500 },
        { tipo: 'platillo', indice: 1, variante: 'Jarra 2000 ml', subtotalCentavos: 13800 * 2 },
        { tipo: 'extra', indice: 0, nombre: 'Toreados', subtotalCentavos: 2100 * 3 },
      ],
      totalCentavos: 52800 + 27600 + 6300,
      totalTexto: '$867.00',
    });
  });
});

describe('obtenerCotizacion', () => {
  it('lee el menú y los sinónimos del repo y cotiza', async () => {
    const repo = crearRepoMenuEnMemoria(seed.filas, seed.sinonimos);
    const args = CotizarPedidoArgsSchema.parse(uno('hamburguesa granero'));
    expect(await obtenerCotizacion(repo, args)).toMatchObject({ ok: true, totalCentavos: 14900 });
  });

  it('propaga el error si el repo falla (la ruta responderá 500)', async () => {
    const args = CotizarPedidoArgsSchema.parse(uno('cowboy'));
    await expect(obtenerCotizacion(repoMenuQueFalla, args)).rejects.toThrow('Supabase no responde');
  });
});
