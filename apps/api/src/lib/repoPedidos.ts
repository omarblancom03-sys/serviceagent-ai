import { EstadoPedidoSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { NuevoPedido, PedidosRepo } from '../services/pedido';

/** Fila que devuelve la función SQL `crear_pedido` (supabase/migrations/*_crear_pedidos.sql). */
const PedidoGuardadoFilaSchema = z.object({
  folio_asignado: z.number().int().positive(),
  total_guardado: z.number().int().positive(),
  estado_actual: EstadoPedidoSchema,
  ya_existia: z.boolean(),
});

/** Renglones como los espera `crear_pedido` en `p_renglones` (snake_case, ids del menú). */
function renglonesParaSql(renglones: NuevoPedido['renglones']) {
  return renglones.map((r, posicion) =>
    r.tipo === 'platillo'
      ? {
          posicion,
          tipo: 'platillo',
          id_platillo: r.idPlatillo,
          id_variante: r.idVariante,
          id_extra: null,
          nombre: r.nombre,
          variante: r.variante,
          cantidad: r.cantidad,
          sin_ingredientes: r.sinIngredientes,
          precio_unitario_centavos: r.precioUnitarioCentavos,
          subtotal_centavos: r.subtotalCentavos,
          extras: r.extras.map((e) => ({
            id_extra: e.idExtra,
            nombre: e.nombre,
            cantidad: e.cantidad,
            precio_unitario_centavos: e.precioUnitarioCentavos,
          })),
        }
      : {
          posicion,
          tipo: 'extra',
          id_platillo: null,
          id_variante: null,
          id_extra: r.idExtra,
          nombre: r.nombre,
          variante: null,
          cantidad: r.cantidad,
          sin_ingredientes: [],
          precio_unitario_centavos: r.precioUnitarioCentavos,
          subtotal_centavos: r.subtotalCentavos,
          extras: [],
        },
  );
}

/** Implementación de `PedidosRepo` sobre Supabase: todo pasa por la función SQL, en una transacción. */
export function crearRepoPedidos(cliente: SupabaseClient): PedidosRepo {
  return {
    async guardarPedido(pedido, minutosDuplicado, ahora) {
      const { data, error } = await cliente.rpc('crear_pedido', {
        p_nombre_cliente: pedido.nombreCliente,
        p_telefono: pedido.telefono,
        p_huella: pedido.huella,
        p_total_centavos: pedido.totalCentavos,
        p_renglones: renglonesParaSql(pedido.renglones),
        p_minutos_duplicado: minutosDuplicado,
        p_ahora: ahora.toISOString(),
      });
      if (error) throw new Error(`No se pudo guardar el pedido: ${error.message}`);

      const [fila] = z.array(PedidoGuardadoFilaSchema).parse(data);
      if (!fila) throw new Error('crear_pedido no devolvió el pedido guardado.');
      return {
        folio: fila.folio_asignado,
        totalCentavos: fila.total_guardado,
        estado: fila.estado_actual,
        yaExistia: fila.ya_existia,
      };
    },
  };
}
