import { EstadoPedidoSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { CancelacionesRepo, ResultadoCancelar } from '../services/cancelacion';

/** Fila que devuelve la función SQL `cancelar_pedido_cliente` (supabase/migrations/*_cancelar_pedido.sql). */
const CancelacionFilaSchema = z.object({
  resultado: z.enum(['cancelado', 'ya_cancelado', 'no_encontrado', 'con_pago', 'no_cancelable']),
  estado_actual: EstadoPedidoSchema.nullable(),
});

/**
 * Implementación de `CancelacionesRepo` sobre Supabase. Los errores llevan solo el código de
 * Postgres: nunca el folio, el teléfono ni el motivo.
 */
export function crearRepoCancelaciones(cliente: SupabaseClient): CancelacionesRepo {
  return {
    async cancelarPedido({ folio, telefono, motivo }): Promise<ResultadoCancelar> {
      const { data, error } = await cliente.rpc('cancelar_pedido_cliente', {
        p_folio: folio,
        p_telefono: telefono,
        p_motivo: motivo,
      });
      if (error) {
        throw new Error(`Falló cancelar_pedido_cliente (código ${error.code ?? 'desconocido'})`);
      }
      const [fila] = z.array(CancelacionFilaSchema).parse(data);
      if (!fila) throw new Error('cancelar_pedido_cliente no devolvió ninguna fila');

      const { resultado, estado_actual: estadoActual } = fila;
      if (resultado === 'con_pago' || resultado === 'no_cancelable') {
        if (estadoActual === null) {
          throw new Error(`cancelar_pedido_cliente respondió ${resultado} sin estado`);
        }
        return { resultado, estadoActual };
      }
      return { resultado };
    },
  };
}
