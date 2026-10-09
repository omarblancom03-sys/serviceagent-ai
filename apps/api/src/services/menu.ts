import type {
  Categoria,
  Extra,
  IngredienteRemovible,
  Platillo,
  RespuestaMenu,
  Variante,
} from '@serviceagent/shared';

/*
 * Reglas del menú público (D19, D20):
 * - Solo aparece lo activo: categoría, platillo, variante, extra e ingrediente removible.
 * - Un platillo sin variantes activas no aparece (el precio vive en la variante).
 * - Una categoría sin platillos visibles no aparece.
 * - Extras ligados (`platillo_extra`) van en `extrasPermitidos` de su platillo; los que no tienen
 *   ninguna fila en `platillo_extra` son sueltos y van en `extras`.
 * - `disponible` siempre es `true` hasta que llegue inventario (v8).
 */

/** Filas del menú tal como están en la base, ya en camelCase y sin filtrar. */
export interface FilasMenu {
  categorias: Categoria[];
  platillos: Omit<
    Platillo,
    'disponible' | 'variantes' | 'extrasPermitidos' | 'ingredientesRemovibles'
  >[];
  variantes: (Omit<Variante, 'disponible'> & { idPlatillo: number })[];
  ingredientesRemovibles: (IngredienteRemovible & { idPlatillo: number; activo: boolean })[];
  extras: Omit<Extra, 'disponible'>[];
  platilloExtra: { idPlatillo: number; idExtra: number }[];
}

/** Frase con la que el cliente puede pedir un platillo (tabla `sinonimo_producto`). */
export interface Sinonimo {
  idPlatillo: number;
  frase: string;
  activo: boolean;
}

/** Acceso a datos del menú. En producción es Supabase; en los tests, memoria. */
export interface MenuRepo {
  leerTodo(): Promise<FilasMenu>;
  /** Aparte de `leerTodo` porque solo los usa cotizar: `GET /menu` no hace esa consulta. */
  leerSinonimos(): Promise<Sinonimo[]>;
}

/** D20: el contrato ya separa `disponible` de `activo`; en v8 aquí se consultará el inventario. */
const DISPONIBLE = true;

const porId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;

function agruparPorPlatillo<T extends { idPlatillo: number }>(filas: T[]) {
  const grupos = new Map<number, T[]>();
  for (const fila of filas) {
    grupos.set(fila.idPlatillo, [...(grupos.get(fila.idPlatillo) ?? []), fila]);
  }
  return grupos;
}

/** Arma la respuesta de `GET /menu` aplicando las reglas de arriba. Función pura. */
export function armarMenu(filas: FilasMenu, ahora: Date = new Date()): RespuestaMenu {
  const extrasActivos = new Map(filas.extras.filter((e) => e.activo).map((e) => [e.id, e]));
  const idsExtrasLigados = new Set(filas.platilloExtra.map((pe) => pe.idExtra));

  const variantesPorPlatillo = agruparPorPlatillo(filas.variantes.filter((v) => v.activo));
  const ingredientesPorPlatillo = agruparPorPlatillo(
    filas.ingredientesRemovibles.filter((i) => i.activo),
  );
  const extrasPorPlatillo = agruparPorPlatillo(filas.platilloExtra);

  const platillos: Platillo[] = filas.platillos
    .filter((p) => p.activo)
    .map((p) => ({
      ...p,
      disponible: DISPONIBLE,
      variantes: (variantesPorPlatillo.get(p.id) ?? [])
        .sort(porId)
        .map(({ id, nombre, precioCentavos, descripcion, activo }) => ({
          id,
          nombre,
          precioCentavos,
          descripcion,
          activo,
          disponible: DISPONIBLE,
        })),
      extrasPermitidos: (extrasPorPlatillo.get(p.id) ?? [])
        .map((pe) => extrasActivos.get(pe.idExtra))
        .filter((e) => e !== undefined)
        .sort(porId)
        .map(({ id, nombre, precioCentavos }) => ({
          id,
          nombre,
          precioCentavos,
          disponible: DISPONIBLE,
        })),
      ingredientesRemovibles: (ingredientesPorPlatillo.get(p.id) ?? [])
        .sort(porId)
        .map(({ id, nombre }) => ({ id, nombre })),
    }))
    .filter((p) => p.variantes.length > 0)
    .sort(porId);

  const categorias = filas.categorias
    .filter((c) => c.activo)
    .sort(porId)
    .map((c) => ({ ...c, platillos: platillos.filter((p) => p.idCategoria === c.id) }))
    .filter((c) => c.platillos.length > 0);

  const extras = [...extrasActivos.values()]
    .filter((e) => !idsExtrasLigados.has(e.id))
    .sort(porId)
    .map((e) => ({ ...e, disponible: DISPONIBLE }));

  return { categorias, extras, timestamp: ahora.toISOString() };
}

export async function obtenerMenu(repo: MenuRepo, ahora?: Date): Promise<RespuestaMenu> {
  return armarMenu(await repo.leerTodo(), ahora);
}

/**
 * Detalle de un platillo tal como sale en el menú. Devuelve `null` si no aparece en el menú
 * (no existe, está inactivo, su categoría está inactiva o no tiene variantes activas).
 */
export async function obtenerPlatillo(repo: MenuRepo, id: number): Promise<Platillo | null> {
  const { categorias } = await obtenerMenu(repo);
  for (const categoria of categorias) {
    const platillo = categoria.platillos.find((p) => p.id === id);
    if (platillo) return platillo;
  }
  return null;
}
