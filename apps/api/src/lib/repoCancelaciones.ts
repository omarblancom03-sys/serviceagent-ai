import { EstadoPedidoSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { CancelacionesRepo, ResultadoCancelar } from '../services/cancelacion';

/**
 * Fila que devuelve la función SQL `cancelar_pedido_cliente`
 * (supabase/migrations/*_limite_folios_cancelacion.sql).
 */
const CancelacionFilaSchema = z.object({
  resultado: z.enum([
    'cancelado',
    'ya_cancelado',
    'no_encontrado',
    'demasiados_intentos',
    'con_pago',
    'no_cancelable',
  ]),
  estado_actual: EstadoPedidoSchema.nullable(),
});

/**
 * Implementación de `CancelacionesRepo` sobre Supabase. Los errores llevan solo el código de
 * Postgres: nunca el folio, el teléfono, el motivo ni el id del chat.
 */
export function crearRepoCancelaciones(cliente: SupabaseClient): CancelacionesRepo {
  return {
    async cancelarPedido({
      folio,
      telefono,
      motivo,
      idChat,
      maxNoEncontrados,
    }): Promise<ResultadoCancelar> {
      const { data, error } = await cliente.rpc('cancelar_pedido_cliente', {
        p_folio: folio,
        p_telefono: telefono,
        p_motivo: motivo,
        p_chat_id: idChat,
        p_max_no_encontrados: maxNoEncontrados,
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
