import {
  CANTIDAD_MAXIMA,
  CANTIDAD_MINIMA,
  type Aclaracion,
  type CotizarPedidoArgs,
  type Extra,
  type ExtraAplicado,
  type ExtraPermitido,
  type Platillo,
  type ProductoPedido,
  type RenglonCotizacion,
  type RenglonPlatillo,
  type RespuestaCotizarPedido,
  type RespuestaMenu,
  type Variante,
} from '@serviceagent/shared';
import { normalizarSuave, palabras } from '../lib/normalizar';
import { formatearPesos } from '../lib/pesos';
import { armarMenu, type MenuRepo, type Sinonimo } from './menu';

/*
 * Cotización de un pedido (US-07-P1). Funciones puras: reciben el menú ya armado por `armarMenu`
 * (así cotizar y `GET /menu` aplican la misma visibilidad, D19 y D20) y no saben de HTTP ni de
 * Supabase.
 *
 * Búsqueda de un platillo en dos pasos (D26), sobre nombres y sinónimos, nunca la descripción:
 * - Paso 1, coincidencia exacta: primero en el nivel suave y luego sin relleno (lib/normalizar.ts).
 *   Si la llave lleva a dos platillos → ambiguo.
 * - Paso 2: los platillos que contienen TODAS las palabras del texto → ambiguo, aunque sea uno
 *   (una coincidencia parcial siempre se pregunta). Ninguno → no_existe.
 */

/** Máximo de opciones en una aclaración `ambiguo`, en el orden del menú. */
export const MAX_OPCIONES = 12;

export interface Catalogo {
  /** Platillos visibles, ordenados por id (el orden del menú). */
  platillos: Platillo[];
  /** Llave suave → ids de platillo. */
  indiceSuave: Map<string, number[]>;
  /** Llave sin relleno → ids de platillo. Excluye los textos genéricos (ver `entraSinRelleno`). */
  indiceSinRelleno: Map<string, number[]>;
  /** Por platillo: las palabras (sin relleno) de su nombre y de cada sinónimo, para el paso 2. */
  palabrasPorPlatillo: Map<number, Set<string>[]>;
  /** Extras que se piden solos (sin filas en `platillo_extra`, D19). */
  extrasSueltos: Extra[];
  /** Extras ligados a algún platillo visible (hoy solo Espuelas), sin repetir. */
  extrasLigados: ExtraPermitido[];
}

export type ResultadoPlatillo =
  | { tipo: 'encontrado'; platillo: Platillo }
  | { tipo: 'ambiguo'; opciones: string[] }
  | { tipo: 'no_existe' };

/**
 * Un texto de la base entra al índice sin relleno, salvo que quitarle el relleno lo deje en una
 * sola palabra. En "El Granero" o "La Boquilla" el artículo es parte del nombre: sin él queda una
 * palabra genérica ("granero" está en 7 platillos) que resolvería en silencio. El nombre completo
 * sigue entrando en el nivel suave. "Guacamole" o "salchichas" sí entran: no tenían relleno.
 */
function entraSinRelleno(llaveSuave: string, sinRelleno: string[]): boolean {
  return sinRelleno.length >= 2 || sinRelleno.length === llaveSuave.split(' ').length;
}

function agregar(indice: Map<string, number[]>, llave: string, id: number) {
  const ids = indice.get(llave) ?? [];
  if (!ids.includes(id)) indice.set(llave, [...ids, id]);
}

/** Arma los índices de búsqueda una vez por petición. Ignora sinónimos inactivos o de platillos no visibles. */
export function armarCatalogo(menu: RespuestaMenu, sinonimos: Sinonimo[]): Catalogo {
  const platillos = menu.categorias.flatMap((c) => c.platillos).sort((a, b) => a.id - b.id);
  const visibles = new Set(platillos.map((p) => p.id));

  const textos: { idPlatillo: number; texto: string }[] = [
    ...platillos.map((p) => ({ idPlatillo: p.id, texto: p.nombre })),
    ...sinonimos
      .filter((s) => s.activo && visibles.has(s.idPlatillo))
      .map((s) => ({ idPlatillo: s.idPlatillo, texto: s.frase })),
  ];

  const catalogo: Catalogo = {
    platillos,
    indiceSuave: new Map(),
    indiceSinRelleno: new Map(),
    palabrasPorPlatillo: new Map(),
    extrasSueltos: menu.extras,
    extrasLigados: [
      ...new Map(platillos.flatMap((p) => p.extrasPermitidos).map((e) => [e.id, e])).values(),
    ],
  };
  for (const { idPlatillo, texto } of textos) {
    const llaveSuave = normalizarSuave(texto);
    const sinRelleno = palabras(texto);
    if (sinRelleno.length === 0) continue; // un sinónimo de puro relleno no identifica nada

    agregar(catalogo.indiceSuave, llaveSuave, idPlatillo);
    if (entraSinRelleno(llaveSuave, sinRelleno)) {
      agregar(catalogo.indiceSinRelleno, sinRelleno.join(' '), idPlatillo);
    }
    const conjuntos = catalogo.palabrasPorPlatillo.get(idPlatillo) ?? [];
    catalogo.palabrasPorPlatillo.set(idPlatillo, [...conjuntos, new Set(sinRelleno)]);
  }
  return catalogo;
}

/** Busca lo que dijo el cliente con las reglas de arriba. */
export function resolverPlatillo(catalogo: Catalogo, texto: string): ResultadoPlatillo {
  const buscadas = palabras(texto);
  // "???" o "la de": sin palabras, el paso 2 coincidiría con todos los platillos.
  if (buscadas.length === 0) return { tipo: 'no_existe' };

  const exactos =
    catalogo.indiceSuave.get(normalizarSuave(texto)) ??
    catalogo.indiceSinRelleno.get(buscadas.join(' '));
  if (exactos) {
    const platillos = catalogo.platillos.filter((p) => exactos.includes(p.id));
    const [unico] = platillos;
    if (platillos.length === 1 && unico) return { tipo: 'encontrado', platillo: unico };
    return { tipo: 'ambiguo', opciones: nombresDe(platillos) };
  }

  const candidatos = buscarPorPalabras(catalogo, buscadas);
  if (candidatos.length === 0) return { tipo: 'no_existe' };
  return { tipo: 'ambiguo', opciones: nombresDe(candidatos) };
}

/**
 * Paso 2: platillos con algún texto (nombre o sinónimo) que contiene todas las palabras, en el
 * orden del menú y sin cortar en `MAX_OPCIONES`.
 */
export function buscarPorPalabras(catalogo: Catalogo, buscadas: string[]): Platillo[] {
  return catalogo.platillos.filter((p) =>
    (catalogo.palabrasPorPlatillo.get(p.id) ?? []).some((conjunto) =>
      buscadas.every((palabra) => conjunto.has(palabra)),
    ),
  );
}

const nombresDe = (platillos: Platillo[]) => platillos.slice(0, MAX_OPCIONES).map((p) => p.nombre);

/*
 * Cálculo de la cotización. Reglas:
 * - Se juntan TODAS las aclaraciones (cada una con su origen e índice); solo si no hay ninguna se
 *   arman los renglones y el total. Nunca se cotiza una parte del pedido.
 * - El dinero sale solo de los precios del catálogo, en centavos (D7):
 *   subtotal = (precioVariante + Σ precioExtra × cantidadExtra) × cantidad.
 * - Las cantidades (platillo, extra ligado y extra suelto) son enteras de 1 a 20 (D30). El mismo
 *   extra repetido en un platillo se suma en uno solo y el límite aplica a la suma.
 */

export const DETALLE_CANTIDAD = `La cantidad debe ser de ${CANTIDAD_MINIMA} a ${CANTIDAD_MAXIMA}.`;

/**
 * Detalle de `cantidad_invalida` para un extra de un platillo. Nombra el extra: la aclaración va
 * con el platillo como `producto` y, sin el nombre, el agente preguntaría cuántos platillos quiere.
 */
export const detalleCantidadExtra = (texto: string) =>
  `La cantidad de "${texto}" debe ser de ${CANTIDAD_MINIMA} a ${CANTIDAD_MAXIMA}.`;

/** `null` si la cantidad es válida; si no, el detalle para la aclaración `cantidad_invalida`. */
export function validarCantidad(cantidad: number, detalle = DETALLE_CANTIDAD): string | null {
  return Number.isInteger(cantidad) && cantidad >= CANTIDAD_MINIMA && cantidad <= CANTIDAD_MAXIMA
    ? null
    : detalle;
}

export type ResultadoVariante =
  { tipo: 'encontrada'; variante: Variante } | { tipo: 'falta_variante'; opciones: string[] };

/**
 * Sin variante pedida: solo vale si el platillo tiene una sola. Con variante pedida (aunque el
 * platillo tenga una sola): la exacta, o la única que contiene todas las palabras pedidas. En
 * cualquier otro caso se pregunta con las variantes reales: el agente nunca adivina.
 */
export function resolverVariante(platillo: Platillo, pedida?: string): ResultadoVariante {
  const { variantes } = platillo;
  const faltante = { tipo: 'falta_variante' as const, opciones: variantes.map((v) => v.nombre) };

  if (pedida === undefined) {
    const [unica] = variantes;
    return variantes.length === 1 && unica ? { tipo: 'encontrada', variante: unica } : faltante;
  }

  const exacta = variantes.find((v) => normalizarSuave(v.nombre) === normalizarSuave(pedida));
  if (exacta) return { tipo: 'encontrada', variante: exacta };

  const buscadas = palabras(pedida);
  const contienen =
    buscadas.length === 0
      ? []
      : variantes.filter((v) => {
          const propias = new Set(palabras(v.nombre));
          return buscadas.every((palabra) => propias.has(palabra));
        });
  const [unica] = contienen;
  return contienen.length === 1 && unica ? { tipo: 'encontrada', variante: unica } : faltante;
}

/**
 * Formas de nombrar un extra: las palabras de su nombre sin paréntesis y las de adentro.
 * "Espuelas (camarones)" → {espuela} y {camaron}; "BBQ" → {bbq}.
 */
function formasDeExtra(nombre: string): Set<string>[] {
  const adentro = [...nombre.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? '');
  return [nombre.replace(/\([^)]*\)/g, ' '), ...adentro]
    .map((texto) => new Set(palabras(texto)))
    .filter((forma) => forma.size > 0);
}

/**
 * Palabras que el cliente agrega al nombre de un extra sin cambiar de cuál habla (D31): "salsa
 * bbq", "chiles toreados", "extra de aguacate", "más totopos". Ya en forma de llave. No incluye
 * "sin" ni "no": cambian el significado.
 */
const PALABRAS_DE_EXTRA: ReadonlySet<string> = new Set(palabras('salsa chile extra más'));

/**
 * Id del extra del menú (suelto o ligado) al que se refiere el cliente (D31). Un extra coincide si
 * lo que dijo contiene todas las palabras de alguna de sus formas Y no trae ninguna otra palabra
 * que no sea suya o de `PALABRAS_DE_EXTRA`. "salsa bbq" → BBQ, "chiles toreados" → Toreados,
 * "espuelas de camarón" → Espuelas. En cambio "sin bbq", "guacamole con totopos" o "camarones al
 * ajillo" no son el extra: cobrarlo sería cobrar algo que no se pidió. Si ninguno o más de uno
 * coincide, no hay extra: se aclara, nunca se adivina.
 */
export function identificarExtra(catalogo: Catalogo, texto: string): number | undefined {
  const dichas = palabras(texto);
  const coinciden = [...catalogo.extrasSueltos, ...catalogo.extrasLigados].filter((e) => {
    const formas = formasDeExtra(e.nombre);
    const propias = new Set(formas.flatMap((forma) => [...forma]));
    return (
      formas.some((forma) => [...forma].every((palabra) => dichas.includes(palabra))) &&
      dichas.every((palabra) => propias.has(palabra) || PALABRAS_DE_EXTRA.has(palabra))
    );
  });
  return coinciden.length === 1 ? coinciden[0]?.id : undefined;
}

/** Extra pedido para un platillo: solo vale si está ligado a ese platillo (`platillo_extra`). */
export function resolverExtra(
  catalogo: Catalogo,
  platillo: Platillo,
  texto: string,
): ExtraPermitido | undefined {
  const id = identificarExtra(catalogo, texto);
  return platillo.extrasPermitidos.find((e) => e.id === id);
}

type IngredienteRemovible = Platillo['ingredientesRemovibles'][number];

/**
 * Otros nombres de un ingrediente, ya en forma de llave (D31): "pimiento" es el Morrón. A
 * propósito NO está "jitomate" → Tomate: en la región, "jitomate" es el tomate verde de la salsa,
 * otro ingrediente; se aclara.
 */
const OTROS_NOMBRES_INGREDIENTE: ReadonlyMap<string, string> = new Map([['pimiento', 'morron']]);

/** Palabras que pueden acompañar al ingrediente sin cambiar cuál es: "sin cebolla", "chile morrón". */
const PALABRAS_DE_INGREDIENTE: ReadonlySet<string> = new Set(palabras('sin chile'));

const palabrasDeIngrediente = (texto: string) =>
  palabras(texto).map((palabra) => OTROS_NOMBRES_INGREDIENTE.get(palabra) ?? palabra);

/**
 * Ingrediente removible del platillo al que se refiere el cliente (D31): el exacto, o el único que
 * coincide por palabras. Coincide si lo dicho está dentro de su nombre ("cebolla" → "Cebolla
 * asada") o si su nombre completo está en lo dicho y lo demás es genérico ("la cebolla", "chile
 * morrón", "pimiento"). Si coinciden dos o ninguno, se aclara: quitar algo cambia lo que prepara
 * cocina.
 */
function resolverIngrediente(platillo: Platillo, pedido: string): IngredienteRemovible | undefined {
  const removibles = platillo.ingredientesRemovibles;
  const exacto = removibles.find((i) => normalizarSuave(i.nombre) === normalizarSuave(pedido));
  if (exacto) return exacto;

  const dichas = palabrasDeIngrediente(pedido);
  if (dichas.length === 0) return undefined;
  const coinciden = removibles.filter((i) => {
    const propias = palabrasDeIngrediente(i.nombre);
    const dentroDelNombre = dichas.every((palabra) => propias.includes(palabra));
    const nombreCompleto =
      propias.every((palabra) => dichas.includes(palabra)) &&
      dichas.every((palabra) => propias.includes(palabra) || PALABRAS_DE_INGREDIENTE.has(palabra));
    return dentroDelNombre || nombreCompleto;
  });
  return coinciden.length === 1 ? coinciden[0] : undefined;
}

/**
 * Ingredientes que se pueden quitar: los removibles del platillo, con su nombre oficial y sin
 * repetir ("tomate" y "tomates" llegan una sola vez al ticket de cocina).
 */
export function resolverIngredientes(
  platillo: Platillo,
  pedidos: string[],
): { quitados: string[]; noRemovibles: string[] } {
  const quitados: string[] = [];
  const noRemovibles: string[] = [];
  for (const pedido of pedidos) {
    const removible = resolverIngrediente(platillo, pedido);
    if (!removible) noRemovibles.push(pedido);
    else if (!quitados.includes(removible.nombre)) quitados.push(removible.nombre);
  }
  return { quitados, noRemovibles };
}

type Aclarar = (aclaracion: Omit<Aclaracion, 'origen' | 'indice' | 'producto'>) => void;

const montos = (precioUnitarioCentavos: number, subtotalCentavos: number) => ({
  precioUnitarioCentavos,
  precioUnitarioTexto: formatearPesos(precioUnitarioCentavos),
  subtotalCentavos,
  subtotalTexto: formatearPesos(subtotalCentavos),
});

/** Revisa un producto pedido. Devuelve su renglón solo si no le hizo falta ninguna aclaración. */
function cotizarProducto(
  catalogo: Catalogo,
  pedido: ProductoPedido,
  indice: number,
  aclarar: Aclarar,
): RenglonPlatillo | null {
  let completo = true;
  const aclararYMarcar: Aclarar = (aclaracion) => {
    completo = false;
    aclarar(aclaracion);
  };

  const encontrado = resolverPlatillo(catalogo, pedido.producto);
  if (encontrado.tipo === 'no_existe') aclararYMarcar({ tipo: 'no_existe' });
  if (encontrado.tipo === 'ambiguo') {
    aclararYMarcar({ tipo: 'ambiguo', opciones: encontrado.opciones });
  }

  const detalleCantidad = validarCantidad(pedido.cantidad);
  if (detalleCantidad) aclararYMarcar({ tipo: 'cantidad_invalida', detalle: detalleCantidad });

  // Sin platillo no hay variantes, extras ni ingredientes contra qué comparar.
  if (encontrado.tipo !== 'encontrado') return null;
  const { platillo } = encontrado;

  const variante = resolverVariante(platillo, pedido.variante);
  if (variante.tipo === 'falta_variante') {
    aclararYMarcar({
      tipo: 'falta_variante',
      opciones: variante.opciones,
      ...(pedido.variante === undefined ? {} : { detalle: pedido.variante }),
    });
  }

  const { quitados, noRemovibles } = resolverIngredientes(platillo, pedido.sinIngredientes ?? []);
  for (const ingrediente of noRemovibles) {
    aclararYMarcar({ tipo: 'ingrediente_no_removible', detalle: ingrediente });
  }

  const extras: ExtraAplicado[] = [];
  for (const { extra: texto, cantidad } of pedido.extras ?? []) {
    const extra = resolverExtra(catalogo, platillo, texto);
    if (!extra) aclararYMarcar({ tipo: 'extra_no_permitido', detalle: texto });
    const detalle = validarCantidad(cantidad, detalleCantidadExtra(texto));
    if (detalle) aclararYMarcar({ tipo: 'cantidad_invalida', detalle });
    if (!extra || detalle) continue;

    // Repetido ("espuelas" 20 y "espuelas" 20): se suma y la suma tampoco pasa de 20 (D30).
    const previo = extras.find((e) => e.idExtra === extra.id);
    if (previo) {
      const detalleSuma = validarCantidad(previo.cantidad + cantidad, detalleCantidadExtra(texto));
      if (detalleSuma) aclararYMarcar({ tipo: 'cantidad_invalida', detalle: detalleSuma });
      else previo.cantidad += cantidad;
      continue;
    }
    extras.push({
      idExtra: extra.id,
      nombre: extra.nombre,
      cantidad,
      precioUnitarioCentavos: extra.precioCentavos,
      precioUnitarioTexto: formatearPesos(extra.precioCentavos),
    });
  }

  if (!completo || variante.tipo !== 'encontrada') return null;
  const { variante: elegida } = variante;
  const precioExtras = extras.reduce((suma, e) => suma + e.precioUnitarioCentavos * e.cantidad, 0);
  return {
    tipo: 'platillo',
    indice,
    idPlatillo: platillo.id,
    nombre: platillo.nombre,
    idVariante: elegida.id,
    // "Guacamole", no "Guacamole Único".
    variante:
      platillo.variantes.length === 1 && normalizarSuave(elegida.nombre) === 'unico'
        ? null
        : elegida.nombre,
    cantidad: pedido.cantidad,
    sinIngredientes: quitados,
    extras,
    ...montos(elegida.precioCentavos, (elegida.precioCentavos + precioExtras) * pedido.cantidad),
  };
}

/** Cotiza el pedido completo, o devuelve todas las aclaraciones que hacen falta. */
export function cotizarPedido(catalogo: Catalogo, args: CotizarPedidoArgs): RespuestaCotizarPedido {
  const aclaraciones: Aclaracion[] = [];
  const renglones: RenglonCotizacion[] = [];

  args.productos.forEach((pedido, indice) => {
    const renglon = cotizarProducto(catalogo, pedido, indice, (aclaracion) =>
      aclaraciones.push({ ...aclaracion, origen: 'producto', indice, producto: pedido.producto }),
    );
    if (renglon) renglones.push(renglon);
  });

  args.extrasSueltos.forEach(({ extra: texto, cantidad }, indice) => {
    const aclarar: Aclarar = (aclaracion) =>
      aclaraciones.push({ ...aclaracion, origen: 'extraSuelto', indice, producto: texto });
    const id = identificarExtra(catalogo, texto);
    const extra = catalogo.extrasSueltos.find((e) => e.id === id);
    // Espuelas solo va con sus cortes (D19); un extra que no está en el menú no existe.
    if (!extra && id !== undefined) aclarar({ tipo: 'extra_no_permitido', detalle: texto });
    else if (!extra) aclarar({ tipo: 'no_existe' });
    const detalle = validarCantidad(cantidad);
    if (detalle) aclarar({ tipo: 'cantidad_invalida', detalle });
    if (extra && !detalle) {
      renglones.push({
        tipo: 'extra',
        indice,
        idExtra: extra.id,
        nombre: extra.nombre,
        cantidad,
        ...montos(extra.precioCentavos, extra.precioCentavos * cantidad),
      });
    }
  });

  if (aclaraciones.length > 0) return { ok: false, aclaraciones };
  const totalCentavos = renglones.reduce((suma, r) => suma + r.subtotalCentavos, 0);
  return { ok: true, renglones, totalCentavos, totalTexto: formatearPesos(totalCentavos) };
}

/** Lee el menú y los sinónimos en paralelo y cotiza. Los errores del repo se propagan (→ 500). */
export async function obtenerCotizacion(
  repo: MenuRepo,
  args: CotizarPedidoArgs,
): Promise<RespuestaCotizarPedido> {
  const [filas, sinonimos] = await Promise.all([repo.leerTodo(), repo.leerSinonimos()]);
  return cotizarPedido(armarCatalogo(armarMenu(filas), sinonimos), args);
}
