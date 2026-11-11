import {
  ESTADOS_COCINA,
  EstadoCocinaSchema,
  EstadoPedidoSchema,
  type RenglonCocina,
} from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type {
  CambioEstadoGuardado,
  CocinaRepo,
  DeshacerGuardado,
  PedidoActivo,
  PedidoTerminado,
  RegresoGuardado,
} from '../services/cocina';

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

const FilaPedidoBaseSchema = z.object({
  folio: z.number().int(),
  nombre_cliente: z.string(),
  creado_en: z.string(),
  historial_estado_pedido: z.array(FilaHistorialSchema),
  renglones_pedido: z.array(FilaRenglonSchema),
});

const FilaPedidoSchema = FilaPedidoBaseSchema.extend({ estado: EstadoCocinaSchema });
/** Un terminado reciente: la consulta ya pide solo los que siguen en 'listo'. */
const FilaPedidoListoSchema = FilaPedidoBaseSchema.extend({ estado: z.literal('listo') });

type FilaPedido = z.infer<typeof FilaPedidoBaseSchema>;

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

/*
 * Filas de `cambiar_estado_cocina` y `deshacer_estado_cocina`
 * (supabase/migrations/*_cocina_cambio_estado.sql). Cero filas: el folio no existe.
 */
const FilaCambioSchema = z.object({
  estado_actual: EstadoPedidoSchema,
  cambiado_en: z.string().nullable(),
});

const FilaDeshacerSchema = z.object({
  estado_actual: EstadoPedidoSchema,
  motivo: z.enum(['estado_distinto', 'plazo_vencido']).nullable(),
});

/*
 * Filas de `leer_terminados_cocina` y `regresar_pedido_cocina`
 * (supabase/migrations/*_cocina_terminados_recientes.sql, US-52).
 */
const FilaTerminadoSchema = z.object({
  folio: z.number().int(),
  terminado_en: z.string(),
});

const FilaRegresoSchema = FilaDeshacerSchema.extend({ cambiado_en: z.string().nullable() });

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

    async leerTerminados({ minutos, limite }): Promise<PedidoTerminado[]> {
      // 1. Qué folios y desde cuándo, con el reloj de Postgres (D42).
      const corte = await cliente.rpc('leer_terminados_cocina', {
        p_minutos: minutos,
        p_limite: limite,
      });
      if (corte.error) {
        throw new Error(`No se pudieron leer los terminados de cocina: ${corte.error.message}`);
      }
      const terminados = z.array(FilaTerminadoSchema).parse(corte.data);
      if (terminados.length === 0) return [];

      // 2. Sus renglones, en la misma forma que los activos. Si uno se regresó o se entregó entre
      // las dos consultas, ya no viene (filtro por 'listo') y no se muestra.
      const { data, error } = await cliente
        .from('pedidos')
        .select(COLUMNAS)
        .in(
          'folio',
          terminados.map((t) => t.folio),
        )
        .eq('estado', 'listo');
      if (error) {
        throw new Error(`No se pudieron leer los terminados de cocina: ${error.message}`);
      }
      const filas = new Map(
        z
          .array(FilaPedidoListoSchema)
          .parse(data)
          .map((fila) => [fila.folio, fila]),
      );

      // En el orden de la función: del más reciente al más viejo.
      return terminados.flatMap((t) => {
        const fila = filas.get(t.folio);
        if (!fila) return [];
        return [
          {
            folio: fila.folio,
            nombreCliente: fila.nombre_cliente,
            enColaDesde: horaEnCola(fila),
            terminadoEn: new Date(t.terminado_en),
            renglones: aRenglones(fila),
          },
        ];
      });
    },

    async cambiarEstado({ folio, desde, hacia, idEmpleado }): Promise<CambioEstadoGuardado | null> {
      const { data, error } = await cliente.rpc('cambiar_estado_cocina', {
        p_folio: folio,
        p_estado_desde: desde,
        p_estado_hacia: hacia,
        p_id_empleado: idEmpleado,
      });
      if (error) throw new Error(`No se pudo cambiar el estado del pedido: ${error.message}`);

      const [fila] = z.array(FilaCambioSchema).max(1).parse(data);
      if (!fila) return null;
      return {
        estadoActual: fila.estado_actual,
        cambiadoEn: fila.cambiado_en ? new Date(fila.cambiado_en) : null,
      };
    },

    async deshacerEstado({ folio, estado, segundosPlazo }): Promise<DeshacerGuardado | null> {
      const { data, error } = await cliente.rpc('deshacer_estado_cocina', {
        p_folio: folio,
        p_estado: estado,
        p_segundos_plazo: segundosPlazo,
      });
      if (error) throw new Error(`No se pudo deshacer el cambio del pedido: ${error.message}`);

      const [fila] = z.array(FilaDeshacerSchema).max(1).parse(data);
      if (!fila) return null;
      return { estadoActual: fila.estado_actual, motivo: fila.motivo };
    },

    async regresarPedido({ folio, idEmpleado, minutosPlazo }): Promise<RegresoGuardado | null> {
      const { data, error } = await cliente.rpc('regresar_pedido_cocina', {
        p_folio: folio,
        p_id_empleado: idEmpleado,
        p_minutos_plazo: minutosPlazo,
      });
      if (error) throw new Error(`No se pudo regresar el pedido: ${error.message}`);

      const [fila] = z.array(FilaRegresoSchema).max(1).parse(data);
      if (!fila) return null;
      return {
        estadoActual: fila.estado_actual,
        motivo: fila.motivo,
        cambiadoEn: fila.cambiado_en ? new Date(fila.cambiado_en) : null,
      };
    },
  };
}
