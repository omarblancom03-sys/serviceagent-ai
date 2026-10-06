import type { CategoriaMenu, Extra, RespuestaMenu } from '@serviceagent/shared';

/*
 * Lógica pura de la pantalla del menú en /admin (US-05): formato, búsqueda, filtro y resumen.
 * Nunca calcula montos: solo da formato a los centavos que manda la API (D7).
 */

/**
 * Centavos a pesos para mostrar: 12900 -> "$129.00", 104900 -> "$1,049.00".
 * Se arma a mano y no con `Intl` para que el texto no dependa del locale (separadores o
 * espacios distintos según el navegador).
 */
export function formatearPesos(centavos: number): string {
  const pesos = Math.trunc(centavos / 100);
  const resto = String(centavos % 100).padStart(2, '0');
  const conMiles = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${conMiles}.${resto}`;
}

/** Minúsculas, sin acentos ni diéresis y sin espacios de sobra: "  Champiñón " -> "champinon". */
export function normalizarTexto(texto: string): string {
  // NFD separa la letra de su acento ("ñ" -> "n" + tilde) y \p{M} borra esas marcas.
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * `true` si todas las palabras de la búsqueda aparecen en el nombre, en cualquier orden:
 * "hamburguesa pollo" encuentra "Hamburguesa de Pollo". Una búsqueda vacía encuentra todo.
 */
export function coincideNombre(nombre: string, busqueda: string): boolean {
  const palabras = normalizarTexto(busqueda).split(' ').filter(Boolean);
  const normalizado = normalizarTexto(nombre);
  return palabras.every((palabra) => normalizado.includes(palabra));
}

export interface FiltroMenu {
  busqueda: string;
  /** `null` = todas las categorías. */
  idCategoria: number | null;
}

export interface MenuFiltrado {
  categorias: CategoriaMenu[];
  /** Extras sueltos: solo se muestran con "Todas" porque no pertenecen a una categoría. */
  extras: Extra[];
}

/** Aplica el selector de categoría y la búsqueda; quita las categorías que quedan vacías. */
export function filtrarMenu(
  menu: RespuestaMenu,
  { busqueda, idCategoria }: FiltroMenu,
): MenuFiltrado {
  const categorias = menu.categorias
    .filter((categoria) => idCategoria === null || categoria.id === idCategoria)
    .map((categoria) => ({
      ...categoria,
      platillos: categoria.platillos.filter((platillo) =>
        coincideNombre(platillo.nombre, busqueda),
      ),
    }))
    .filter((categoria) => categoria.platillos.length > 0);

  const extras =
    idCategoria === null
      ? menu.extras.filter((extra) => coincideNombre(extra.nombre, busqueda))
      : [];

  return { categorias, extras };
}

export interface ResumenMenu {
  categorias: number;
  platillos: number;
  variantes: number;
  extrasSueltos: number;
}

/** Cuántos elementos trae el menú (conteos, no montos), para compararlo contra el seed. */
export function resumirMenu(menu: Pick<RespuestaMenu, 'categorias' | 'extras'>): ResumenMenu {
  const platillos = menu.categorias.flatMap((categoria) => categoria.platillos);
  return {
    categorias: menu.categorias.length,
    platillos: platillos.length,
    variantes: platillos.reduce((cuenta, platillo) => cuenta + platillo.variantes.length, 0),
    extrasSueltos: menu.extras.length,
  };
}

/**
 * Hora (HH:MM, 24 h) del `timestamp` de la respuesta. La zona es un parámetro para poder
 * probarla; en la pantalla se usa la del navegador.
 */
export function formatearHora(timestamp: string, zonaHoraria?: string): string {
  return new Date(timestamp).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zonaHoraria,
  });
}
