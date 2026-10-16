import type { Variante } from '@serviceagent/shared';
import { ErrorApi } from './api';
import { normalizarTexto } from './menuAdmin';

/*
 * Qué muestra el listado del menú en cada pantalla: /admin (US-05) y /menu del cliente (US-09-P2).
 * `ListadoMenu` solo lee estas opciones; aquí vive toda la diferencia entre los dos modos.
 */

export type ModoMenu = 'admin' | 'cliente';

export interface OpcionesVista {
  /** "Cargado: N categorías · N platillos · …". */
  mostrarResumen: boolean;
  /** "… actualizado a las HH:MM", al final del resumen. */
  mostrarHora: boolean;
  /** "Mostrando N platillos y N extras sueltos". */
  mostrarConteoFiltrado: boolean;
  /** Etiqueta "Prep. N min" o "Sin tiempo de prep." en cada platillo. */
  mostrarTiempoPrep: boolean;
  /** "Prep. = tiempo base de preparación, en minutos". */
  mostrarLeyendaPrep: boolean;
  /** La búsqueda también mira el nombre de la categoría. */
  buscarPorCategoria: boolean;
  /** Un platillo con una sola variante "Único" muestra solo el precio. */
  simplificarVarianteUnica: boolean;
  /** Mensaje de error con código HTTP y causa (empleados) o uno solo y claro (cliente). */
  errorDetallado: boolean;
  subtitulo: string;
  etiquetaBusqueda: string;
  placeholderBusqueda: string;
  /** Cómo se queda fija arriba la barra de búsqueda al hacer scroll. */
  claseBarraFija: string;
  /** Clases extra del campo de búsqueda y del selector de categoría. */
  claseCampo: string;
  claseReintentar: string;
}

const OPCIONES: Record<ModoMenu, OpcionesVista> = {
  admin: {
    mostrarResumen: true,
    mostrarHora: true,
    mostrarConteoFiltrado: true,
    mostrarTiempoPrep: true,
    mostrarLeyendaPrep: true,
    buscarPorCategoria: false,
    simplificarVarianteUnica: false,
    errorDetallado: true,
    subtitulo: 'Consulta de solo lectura del menú vigente.',
    etiquetaBusqueda: 'Buscar por nombre',
    placeholderBusqueda: 'Ej. hamburguesa pollo',
    claseBarraFija: 'sticky top-0 z-10',
    claseCampo: '',
    claseReintentar: 'font-semibold underline',
  },
  cliente: {
    mostrarResumen: false,
    mostrarHora: false,
    mostrarConteoFiltrado: false,
    mostrarTiempoPrep: false,
    mostrarLeyendaPrep: false,
    buscarPorCategoria: true,
    simplificarVarianteUnica: true,
    errorDetallado: false,
    subtitulo: 'Platillos, precios y opciones.',
    etiquetaBusqueda: 'Buscar platillo o categoría',
    placeholderBusqueda: 'Ej. hamburguesa, mariscos, tacos',
    // En celular la barra ocupa mucho alto: solo se queda fija desde md.
    claseBarraFija: 'md:sticky md:top-0 md:z-10',
    claseCampo: 'min-h-11',
    claseReintentar:
      'mt-3 block min-h-11 rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800',
  },
};

export function opcionesVista(modo: ModoMenu): OpcionesVista {
  return OPCIONES[modo];
}

/** Une clases de Tailwind sin dejar espacios de sobra por las vacías. */
export function unirClases(...clases: string[]): string {
  return clases.filter(Boolean).join(' ');
}

/**
 * Nombre que se muestra junto al precio de la variante, o `null` si solo va el precio: pasa cuando
 * `simplificarUnica` está activo y el platillo tiene una sola variante llamada "Único".
 */
export function nombreVarianteVisible(
  variante: Pick<Variante, 'nombre'>,
  totalVariantes: number,
  simplificarUnica: boolean,
): string | null {
  const esUnica = totalVariantes === 1 && normalizarTexto(variante.nombre) === 'unico';
  return simplificarUnica && esUnica ? null : variante.nombre;
}

export const MENSAJE_ERROR_CLIENTE = 'No pudimos cargar el menú. Intenta de nuevo en unos minutos.';

/**
 * Texto del error al cargar el menú. Sin `detallado` (cliente) es siempre el mismo, sin códigos ni
 * causas técnicas. zod no es dependencia directa de la web: su error se reconoce por el nombre.
 */
export function mensajeErrorMenu(error: unknown, detallado: boolean): string {
  if (!detallado) return MENSAJE_ERROR_CLIENTE;
  if (error instanceof ErrorApi) {
    return `La API respondió con un error (${error.status}). Intenta de nuevo en un momento.`;
  }
  if (error instanceof Error && error.name === 'ZodError') {
    return 'La respuesta del menú no tiene el formato esperado. Avisa al equipo de desarrollo.';
  }
  return 'No se pudo conectar con la API. Revisa la conexión e intenta de nuevo.';
}
