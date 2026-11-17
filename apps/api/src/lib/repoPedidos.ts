import { EstadoPedidoSchema, MetodoPagoSchema, ModoPagoSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { NuevoPedido, PedidosRepo } from '../services/pedido';

/** Fila que devuelve la función SQL `crear_pedido` (supabase/migrations/*_metodo_pago_transferencia.sql). */
const PedidoGuardadoFilaSchema = z.object({
  folio_asignado: z.number().int().positive(),
  total_guardado: z.number().int().positive(),
  estado_actual: EstadoPedidoSchema,
  ya_existia: z.boolean(),
  modo_pago: ModoPagoSchema,
  metodo_pago: MetodoPagoSchema.nullable(),
  referencia_pago: z.string().nullable(),
  clabe_transferencia: z
    .string()
    .regex(/^\d{18}$/)
    .nullable(),
});

/** Fila de `pedir_datos_whatsapp`. */
const DatosWhatsappFilaSchema = z.object({
  resultado: z.enum(['pedido', 'ya_pedido', 'no_aplica', 'no_encontrado']),
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
    async leerModoPago() {
      const { data, error } = await cliente
        .from('configuracion_restaurante')
        .select('modo_pago')
        .single();
      if (error) throw new Error(`No se pudo leer el modo de pago: ${error.message}`);
      return z.object({ modo_pago: ModoPagoSchema }).parse(data).modo_pago;
    },

    async pedirDatosWhatsapp(folio, telefono) {
      const { data, error } = await cliente.rpc('pedir_datos_whatsapp', {
        p_folio: folio,
        p_telefono: telefono,
      });
      if (error) throw new Error(`No se pudo anotar el pedido de WhatsApp: ${error.message}`);
      const [fila] = z.array(DatosWhatsappFilaSchema).parse(data);
      if (!fila) throw new Error('pedir_datos_whatsapp no devolvió resultado.');
      return fila.resultado;
    },

    async guardarPedido(pedido, minutosDuplicado) {
      const { data, error } = await cliente.rpc('crear_pedido', {
        p_nombre_cliente: pedido.nombreCliente,
        p_telefono: pedido.telefono,
        p_huella: pedido.huella,
        p_total_centavos: pedido.totalCentavos,
        p_renglones: renglonesParaSql(pedido.renglones),
        p_minutos_duplicado: minutosDuplicado,
        p_metodo_pago: pedido.metodoPago,
      });
      if (error) throw new Error(`No se pudo guardar el pedido: ${error.message}`);

      const [fila] = z.array(PedidoGuardadoFilaSchema).parse(data);
      if (!fila) throw new Error('crear_pedido no devolvió el pedido guardado.');
      return {
        folio: fila.folio_asignado,
        totalCentavos: fila.total_guardado,
        estado: fila.estado_actual,
        modoPago: fila.modo_pago,
        metodoPago: fila.metodo_pago,
        referenciaPago: fila.referencia_pago,
        clabeTransferencia: fila.clabe_transferencia,
        yaExistia: fila.ya_existia,
      };
    },
  };
}
