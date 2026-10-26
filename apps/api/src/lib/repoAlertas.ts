import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { AlertasRepo } from '../services/alerta';

/** Fila que devuelve la función SQL `crear_alerta_atencion` (supabase/migrations/*_crear_alertas_atencion.sql). */
const AlertaGuardadaFilaSchema = z.object({
  creada: z.boolean(),
  folio_no_encontrado: z.boolean(),
});

/**
 * Implementación de `AlertasRepo` sobre Supabase. Los errores llevan solo el código de Postgres:
 * nunca el `chat_id`, el teléfono ni el motivo.
 */
export function crearRepoAlertas(cliente: SupabaseClient): AlertasRepo {
  return {
    async crearAlerta(alerta) {
      const { data, error } = await cliente.rpc('crear_alerta_atencion', {
        p_chat_id: alerta.idChat,
        p_telefono: alerta.telefono,
        p_nombre_cliente: alerta.nombreCliente,
        p_folio: alerta.folio,
        p_motivo: alerta.motivo,
      });
      if (error) {
        throw new Error(`Falló crear_alerta_atencion (código ${error.code ?? 'desconocido'})`);
      }
      const [fila] = z.array(AlertaGuardadaFilaSchema).parse(data);
      if (!fila) throw new Error('crear_alerta_atencion no devolvió ninguna fila');
      return { creada: fila.creada, folioNoEncontrado: fila.folio_no_encontrado };
    },
  };
}
