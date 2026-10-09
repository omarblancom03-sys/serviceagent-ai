import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FilasMenu, Sinonimo } from '../src/services/menu';

/*
 * Menú real para los tests: lee supabase/seed/01_menu_el_granero.sql y 02_platillo_extra.sql como
 * texto (sin conectarse a Supabase) y los convierte en las filas que devolvería el repo. Los ids
 * siguen el orden del archivo, como al cargar el seed en una base vacía. Aplica también la
 * sección 6 (sinónimos retirados), igual que la base.
 */

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const leerSeed = (archivo: string) =>
  readFileSync(path.join(raizRepo, 'supabase/seed', archivo), 'utf-8');

function bloque(contenido: string, inicio: string, fin?: string): string {
  const i = contenido.indexOf(inicio);
  if (i === -1) throw new Error(`No se encontró "${inicio}" en el seed.`);
  const j = fin ? contenido.indexOf(fin, i) : -1;
  return contenido.slice(i, j === -1 ? undefined : j);
}

const coincidencias = (texto: string, patron: RegExp) =>
  [...texto.matchAll(patron)].map((m) => m.slice(1).map((grupo) => grupo ?? ''));

/**
 * `removibles`: ingredientes removibles DE PRUEBA. El seed todavía no trae ninguno (los aprueba el
 * PO y se cargan en el PR B3, D29); sirven para probar la regla sin inventar datos del menú.
 */
export function leerSeedMenu({
  removibles = [],
}: { removibles?: { platillo: string; nombre: string }[] } = {}): {
  filas: FilasMenu;
  sinonimos: Sinonimo[];
} {
  const menu = leerSeed('01_menu_el_granero.sql');
  const platilloExtra = leerSeed('02_platillo_extra.sql');

  const categorias = coincidencias(
    bloque(menu, '1) CATEGORIAS', '2) PLATILLOS'),
    /\('([^']+)'\)/g,
  ).map(([nombre = ''], i) => ({ id: i + 1, nombre, descripcion: null, activo: true }));
  const idCategoria = new Map(categorias.map((c) => [c.nombre, c.id]));

  const platillos = coincidencias(
    bloque(menu, '2) PLATILLOS', '3) VARIANTES'),
    /\('([^']+)',\s*'([^']+)',\s*'([^']*)'\)/g,
  ).map(([categoria = '', nombre = '', descripcion = ''], i) => ({
    id: i + 1,
    idCategoria: idCategoria.get(categoria) ?? 0,
    nombre,
    descripcion,
    imagen: null,
    tiempoEstimadoMin: null,
    activo: true,
  }));
  const idPlatillo = (nombre: string) => {
    const platillo = platillos.find((p) => p.nombre === nombre);
    if (!platillo) throw new Error(`El seed menciona un platillo que no existe: "${nombre}".`);
    return platillo.id;
  };

  const variantes = coincidencias(
    bloque(menu, '3) VARIANTES', '4) SINONIMOS'),
    /\('([^']+)',\s*'([^']+)',\s*(\d+)\)/g,
  ).map(([platillo = '', nombre = '', precio = ''], i) => ({
    id: i + 1,
    idPlatillo: idPlatillo(platillo),
    nombre,
    precioCentavos: Number(precio),
    descripcion: null,
    activo: true,
  }));

  const pares = /\('([^']+)',\s*'([^']+)'\)/g;
  const retirados = new Set(
    coincidencias(bloque(menu, '6) SINONIMOS RETIRADOS'), pares).map((par) => par.join('|')),
  );
  const sinonimos = coincidencias(bloque(menu, '4) SINONIMOS', '5) EXTRAS'), pares)
    .filter((par) => !retirados.has(par.join('|')))
    .map(([platillo = '', frase = '']) => ({
      idPlatillo: idPlatillo(platillo),
      frase,
      activo: true,
    }));

  const extras = coincidencias(
    bloque(menu, '5) EXTRAS', '6) SINONIMOS RETIRADOS'),
    /\('([^']+)',\s*(\d+),\s*'([^']*)'\)/g,
  ).map(([nombre = '', precio = '', descripcion = ''], i) => ({
    id: i + 1,
    nombre,
    precioCentavos: Number(precio),
    descripcion,
    activo: true,
  }));
  const espuelas = extras.find((e) => e.nombre === 'Espuelas (camarones)');
  if (!espuelas) throw new Error('El seed no trae el extra "Espuelas (camarones)".');

  return {
    filas: {
      categorias,
      platillos,
      variantes,
      ingredientesRemovibles: removibles.map(({ platillo, nombre }, i) => ({
        id: i + 1,
        idPlatillo: idPlatillo(platillo),
        nombre,
        activo: true,
      })),
      extras,
      platilloExtra: coincidencias(platilloExtra, /^\s*\('([^']+)'\),?$/gm).map(
        ([nombre = '']) => ({
          idPlatillo: idPlatillo(nombre),
          idExtra: espuelas.id,
        }),
      ),
    },
    sinonimos,
  };
}
