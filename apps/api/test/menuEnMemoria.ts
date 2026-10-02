import type { FilasMenu, MenuRepo } from '../src/services/menu';

/**
 * Menú chico con un caso de cada regla (nombres y precios del seed real):
 * - Categoría 3 activa pero sin platillos y categoría 4 inactiva: no aparecen.
 * - Platillo 4 inactivo, 5 sin variantes activas y 6 en categoría inactiva: no aparecen.
 * - Queso fundido (3) tiene una variante inactiva y `tiempoEstimadoMin` en null.
 * - Espuelas (5) ligada a los cortes; el extra 6 está ligado pero inactivo; Aguacate (2) inactivo.
 * Las filas vienen desordenadas a propósito para probar el orden por id.
 */
export function filasMenuDePrueba(): FilasMenu {
  const variante = (
    id: number,
    idPlatillo: number,
    nombre: string,
    precio: number,
    activo = true,
  ) => ({
    id,
    idPlatillo,
    nombre,
    precioCentavos: precio,
    descripcion: null,
    activo,
  });
  const platillo = (
    id: number,
    idCategoria: number,
    nombre: string,
    tiempoEstimadoMin: number | null,
    activo = true,
  ) => ({ id, idCategoria, nombre, descripcion: '', imagen: null, tiempoEstimadoMin, activo });

  return {
    categorias: [
      { id: 2, nombre: 'Cortes', descripcion: null, activo: true },
      { id: 1, nombre: 'De entradas al rancho', descripcion: 'Para abrir boca.', activo: true },
      { id: 3, nombre: 'Categoría vacía', descripcion: null, activo: true },
      { id: 4, nombre: 'Temporada', descripcion: null, activo: false },
    ],
    platillos: [
      platillo(3, 1, 'Queso fundido', null),
      platillo(1, 1, 'Guacamole', 15),
      platillo(2, 2, 'T-Bone 450 gr', 30),
      platillo(7, 2, 'Arrachera 450 gr', 30),
      platillo(4, 1, 'Platillo dado de baja', 15, false),
      platillo(5, 1, 'Sin variantes activas', 15),
      platillo(6, 4, 'Ponche', 10),
    ],
    variantes: [
      variante(4, 3, 'Con chorizo', 11000, false),
      variante(3, 3, 'Natural', 9000),
      variante(1, 1, 'Único', 12300),
      variante(2, 2, 'Único', 45000),
      variante(8, 7, 'Único', 39000),
      variante(5, 4, 'Único', 5000),
      variante(6, 5, 'Único', 5000, false),
      variante(7, 6, 'Único', 4000),
    ],
    ingredientesRemovibles: [
      { id: 2, idPlatillo: 1, nombre: 'Cilantro', activo: false },
      { id: 1, idPlatillo: 1, nombre: 'Cebolla', activo: true },
    ],
    extras: [
      {
        id: 5,
        nombre: 'Espuelas (camarones)',
        precioCentavos: 5500,
        descripcion: null,
        activo: true,
      },
      {
        id: 1,
        nombre: 'Totopos',
        precioCentavos: 2000,
        descripcion: 'Porción extra.',
        activo: true,
      },
      { id: 2, nombre: 'Aguacate', precioCentavos: 2500, descripcion: null, activo: false },
      {
        id: 6,
        nombre: 'Extra ligado inactivo',
        precioCentavos: 1000,
        descripcion: null,
        activo: false,
      },
    ],
    platilloExtra: [
      { idPlatillo: 2, idExtra: 5 },
      { idPlatillo: 7, idExtra: 5 },
      { idPlatillo: 2, idExtra: 6 },
    ],
  };
}

/** Repo en memoria. Cada lectura devuelve una copia para que nadie modifique los datos. */
export function crearRepoMenuEnMemoria(filas: FilasMenu = filasMenuDePrueba()): MenuRepo {
  return {
    async leerTodo() {
      return structuredClone(filas);
    },
  };
}

/** Repo que siempre falla, para probar el 500. */
export const repoMenuQueFalla: MenuRepo = {
  async leerTodo() {
    throw new Error('Supabase no responde');
  },
};
