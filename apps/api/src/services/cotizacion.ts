import type { Platillo, RespuestaMenu } from '@serviceagent/shared';
import { normalizarSuave, palabras } from '../lib/normalizar';
import type { Sinonimo } from './menu';

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

  const candidatos = catalogo.platillos.filter((p) =>
    (catalogo.palabrasPorPlatillo.get(p.id) ?? []).some((conjunto) =>
      buscadas.every((palabra) => conjunto.has(palabra)),
    ),
  );
  if (candidatos.length === 0) return { tipo: 'no_existe' };
  return { tipo: 'ambiguo', opciones: nombresDe(candidatos) };
}

const nombresDe = (platillos: Platillo[]) => platillos.slice(0, MAX_OPCIONES).map((p) => p.nombre);
