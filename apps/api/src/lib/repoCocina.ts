import { ESTADOS_COCINA, EstadoCocinaSchema, type RenglonCocina } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { CocinaRepo, PedidoActivo } from '../services/cocina';

/*
 * Filas de los pedidos activos con sus tablas relacionadas, en una sola consulta de PostgREST
 * (supabase/migrations/*_crear_pedidos.sql). Se validan con zod al leerlas.
 */
const FilaExtraSchema = z.object({
  id_extra_renglon: z.number().int(),
  nombre: z.string(),
  cantidad: z.number().int(),
});

const FilaRenglonSchema = z.object({
  posicion: z.number().int(),
  tipo: z.enum(['platillo', 'extra']),
  nombre: z.string(),
  variante: z.string().nullable(),
  cantidad: z.number().int(),
  sin_ingredientes: z.array(z.string()),
  extras_renglon_pedido: z.array(FilaExtraSchema),
});

const FilaHistorialSchema = z.object({
  estado: z.string(),
  creado_en: z.string(),
});

const FilaPedidoSchema = z.object({
  folio: z.number().int(),
  nombre_cliente: z.string(),
  estado: EstadoCocinaSchema,
  creado_en: z.string(),
  historial_estado_pedido: z.array(FilaHistorialSchema),
  renglones_pedido: z.array(FilaRenglonSchema),
});

type FilaPedido = z.infer<typeof FilaPedidoSchema>;

const COLUMNAS =
  'folio, nombre_cliente, estado, creado_en, ' +
  'historial_estado_pedido(estado, creado_en), ' +
  'renglones_pedido(posicion, tipo, nombre, variante, cantidad, sin_ingredientes, ' +
  'extras_renglon_pedido(id_extra_renglon, nombre, cantidad))';

/**
 * Hora en que entró a la cola: la última vez que el historial dice 'en_cola'. Si no la hubiera (no
 * debería pasar: `crear_pedido` la guarda), se usa la hora en que se creó el pedido.
 */
function horaEnCola(fila: FilaPedido): Date {
  const horas = fila.historial_estado_pedido
    .filter((h) => h.estado === 'en_cola')
    .map((h) => new Date(h.creado_en).getTime());
  return new Date(horas.length > 0 ? Math.max(...horas) : fila.creado_en);
}

function aRenglones(fila: FilaPedido): RenglonCocina[] {
  return [...fila.renglones_pedido]
    .sort((a, b) => a.posicion - b.posicion)
    .map((r) =>
      r.tipo === 'platillo'
        ? {
            tipo: 'platillo' as const,
            cantidad: r.cantidad,
            nombre: r.nombre,
            variante: r.variante,
            sinIngredientes: r.sin_ingredientes,
            extras: [...r.extras_renglon_pedido]
              .sort((a, b) => a.id_extra_renglon - b.id_extra_renglon)
              .map((e) => ({ nombre: e.nombre, cantidad: e.cantidad })),
          }
        : { tipo: 'extra' as const, cantidad: r.cantidad, nombre: r.nombre },
    );
}

/** Implementación de `CocinaRepo` sobre Supabase. */
export function crearRepoCocina(cliente: SupabaseClient): CocinaRepo {
  return {
    async leerPedidosActivos(): Promise<PedidoActivo[]> {
      const { data, error } = await cliente
        .from('pedidos')
        .select(COLUMNAS)
        .in('estado', [...ESTADOS_COCINA]);
      if (error) throw new Error(`No se pudieron leer los pedidos de cocina: ${error.message}`);

      return z
        .array(FilaPedidoSchema)
        .parse(data)
        .map((fila) => ({
          folio: fila.folio,
          nombreCliente: fila.nombre_cliente,
          estado: fila.estado,
          enColaDesde: horaEnCola(fila),
          renglones: aRenglones(fila),
        }));
    },
  };
}
