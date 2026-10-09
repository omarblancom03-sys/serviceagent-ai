import { describe, expect, it } from 'vitest';
import { palabras } from '../src/lib/normalizar';
import {
  armarCatalogo,
  buscarPorPalabras,
  MAX_OPCIONES,
  resolverPlatillo,
  type ResultadoPlatillo,
} from '../src/services/cotizacion';
import { armarMenu, type FilasMenu } from '../src/services/menu';
import { filasMenuDePrueba } from './menuEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

const seed = leerSeedMenu();
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
