/**
 * Normalización de textos para comparar lo que dijo el cliente con nombres y sinónimos del menú
 * (US-07). Se aplica IGUAL a los dos lados: así no hace falta cargar un sinónimo por cada forma de
 * escribir lo mismo (mayúsculas, acentos, signos, plurales).
 *
 * Hay dos niveles:
 * - `normalizarSuave`: minúsculas, sin acentos ni signos, espacios colapsados y plurales a una
 *   llave común. Respeta todas las palabras que dijo el cliente.
 * - `normalizarSinRelleno`: lo mismo, pero además quita palabras de relleno ("la de", "una orden
 *   de"). Se usa solo si el nivel suave no encontró nada, para no perder el nombre exacto: con
 *   relleno quitado, "el granero" (tacos) queda igual que "granero", que está en 7 platillos.
 *
 * El resultado es una LLAVE para comparar, no un texto para mostrar ("postres" → "postr").
 */

/**
 * Palabras que no distinguen un platillo de otro. Ya en forma de llave (`llavePlural`), porque el
 * relleno se quita después de normalizar cada palabra. No incluye "sin" (cambia el significado) ni
 * números o unidades ("450", "gr", "ml"), que sí distinguen platillos y variantes.
 */
export const PALABRAS_RELLENO: ReadonlySet<string> = new Set(
  [
    'el',
    'la',
    'los',
    'las',
    'lo',
    'un',
    'una',
    'uno',
    'unos',
    'unas',
    'de',
    'del',
    'al',
    'con',
    'y',
    'quiero',
    'quisiera',
    'dame',
    'deme',
    'me',
    'pon',
    'ponme',
    'orden',
    'ordenes',
    'porcion',
    'porciones',
    'por',
    'favor',
    'otra',
    'otro',
  ].map(llavePlural),
);

/**
 * Lleva el singular y el plural de una palabra a la misma llave. En español, lo que termina en
 * vocal agrega "-s" (postre → postres) y lo que termina en consonante, "-es" (frijol → frijoles):
 * se quita la "s" final y, si queda una "e" después de l, n, r, d, z o j, también esa "e". La "e"
 * se quita aunque la palabra venga en singular (postre → postr), para que ambas formas coincidan.
 * Palabras de 3 letras o menos ("res", "mas"), con dígitos ("450") o que terminan en "ss"
 * ("boneless", que no es plural) no pierden la "s".
 */
export function llavePlural(palabra: string): string {
  if (palabra.length <= 3 || /\d/.test(palabra)) return palabra;
  let llave = palabra.endsWith('s') && !palabra.endsWith('ss') ? palabra.slice(0, -1) : palabra;
  if (llave.length > 3 && /[lnrdzj]e$/.test(llave)) llave = llave.slice(0, -1);
  return llave;
}

/** Palabras normalizadas sin quitar relleno. */
function palabrasSuaves(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // quita acentos y la tilde de la ñ
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') // signos ("t-bone", "1/2") cuentan como espacio
    .split(' ')
    .filter((palabra) => palabra !== '')
    .map(llavePlural);
}

/** Nivel 1: respeta todas las palabras. "Hamburguesas  ALGODONEROS" → "hamburguesa algodonero". */
export function normalizarSuave(texto: string): string {
  return palabrasSuaves(texto).join(' ');
}

/** Palabras del texto sin relleno: "la de chipotle" → ["chipotle"]. Base del nivel 2 y del paso 2. */
export function palabras(texto: string): string[] {
  return palabrasSuaves(texto).filter((palabra) => !PALABRAS_RELLENO.has(palabra));
}

/** Nivel 2: como el suave, pero sin relleno. "una orden de papas" → "papa". */
export function normalizarSinRelleno(texto: string): string {
  return palabras(texto).join(' ');
}

/**
 * Llave de un extra: ignora lo que va entre paréntesis (los extras no tienen sinónimos).
 * "Espuelas (camarones)" y "espuelas" → "espuela".
 */
export function normalizarExtra(texto: string): string {
  return normalizarSuave(texto.replace(/\([^)]*\)/g, ' '));
}
