import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { MenuRepo } from '../services/menu';

/* Filas de las tablas del menú (supabase/migrations/*_crear_esquema_menu.sql y *_crear_platillo_extra.sql). */
const FilaCategoriaSchema = z.object({
  id_categoria: z.number().int(),
  nombre: z.string(),
  descripcion: z.string().nullable(),
  activo: z.boolean(),
});

const FilaPlatilloSchema = z.object({
  id_platillo: z.number().int(),
  id_categoria: z.number().int(),
  nombre: z.string(),
  descripcion: z.string(),
  imagen: z.string().nullable(),
  tiempo_estimado_min: z.number().int().nullable(),
  activo: z.boolean(),
});

const FilaVarianteSchema = z.object({
  id_variante: z.number().int(),
  id_platillo: z.number().int(),
  nombre: z.string(),
  precio_centavos: z.number().int(),
  descripcion: z.string().nullable(),
  activo: z.boolean(),
});

const FilaIngredienteSchema = z.object({
  id_ingrediente_removible: z.number().int(),
  id_platillo: z.number().int(),
  nombre: z.string(),
  activo: z.boolean(),
});

const FilaExtraSchema = z.object({
  id_extra: z.number().int(),
  nombre: z.string(),
  precio_centavos: z.number().int(),
  descripcion: z.string().nullable(),
  activo: z.boolean(),
});

const FilaPlatilloExtraSchema = z.object({
  id_platillo: z.number().int(),
  id_extra: z.number().int(),
});

/**
 * Implementación de `MenuRepo` sobre Supabase. Lee las tablas completas en paralelo (el menú es
 * chico) y deja los filtros a `services/menu.ts`. Valida con zod lo que devuelve la base.
 */
export function crearRepoMenu(cliente: SupabaseClient): MenuRepo {
  async function leer<T extends z.ZodType>(tabla: string, columnas: string, fila: T) {
    const { data, error } = await cliente.from(tabla).select(columnas);
    if (error) throw new Error(`No se pudo leer ${tabla}: ${error.message}`);
    return z.array(fila).parse(data);
  }

  return {
    async leerTodo() {
      const [categorias, platillos, variantes, ingredientes, extras, platilloExtra] =
        await Promise.all([
          leer(
            'categoria_producto',
            'id_categoria, nombre, descripcion, activo',
            FilaCategoriaSchema,
          ),
          leer(
            'platillo',
            'id_platillo, id_categoria, nombre, descripcion, imagen, tiempo_estimado_min, activo',
            FilaPlatilloSchema,
          ),
          leer(
            'variante_producto',
            'id_variante, id_platillo, nombre, precio_centavos, descripcion, activo',
            FilaVarianteSchema,
          ),
          leer(
            'ingrediente_removible',
            'id_ingrediente_removible, id_platillo, nombre, activo',
            FilaIngredienteSchema,
          ),
          leer('extra', 'id_extra, nombre, precio_centavos, descripcion, activo', FilaExtraSchema),
          leer('platillo_extra', 'id_platillo, id_extra', FilaPlatilloExtraSchema),
        ]);

      return {
        categorias: categorias.map((c) => ({
          id: c.id_categoria,
          nombre: c.nombre,
          descripcion: c.descripcion,
          activo: c.activo,
        })),
        platillos: platillos.map((p) => ({
          id: p.id_platillo,
          idCategoria: p.id_categoria,
          nombre: p.nombre,
          descripcion: p.descripcion,
          imagen: p.imagen,
          tiempoEstimadoMin: p.tiempo_estimado_min,
          activo: p.activo,
        })),
        variantes: variantes.map((v) => ({
          id: v.id_variante,
          idPlatillo: v.id_platillo,
          nombre: v.nombre,
          precioCentavos: v.precio_centavos,
          descripcion: v.descripcion,
          activo: v.activo,
        })),
        ingredientesRemovibles: ingredientes.map((i) => ({
          id: i.id_ingrediente_removible,
          idPlatillo: i.id_platillo,
          nombre: i.nombre,
          activo: i.activo,
        })),
        extras: extras.map((e) => ({
          id: e.id_extra,
          nombre: e.nombre,
          precioCentavos: e.precio_centavos,
          descripcion: e.descripcion,
          activo: e.activo,
        })),
        platilloExtra: platilloExtra.map((pe) => ({
          idPlatillo: pe.id_platillo,
          idExtra: pe.id_extra,
        })),
      };
    },
  };
}
