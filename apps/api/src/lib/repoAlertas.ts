import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { AlertasRepo } from '../services/alerta';

/** Fila que devuelve la función SQL `crear_alerta_atencion` (supabase/migrations/*_crear_alertas_atencion.sql). */
const AlertaGuardadaFilaSchema = z.object({
  creada: z.boolean(),
  folio_no_encontrado: z.boolean(),
});

/** Columnas que lee caja de `alertas_atencion`. Nunca `chat_id_retell` (D36). */
const COLUMNAS_PENDIENTE = 'id_alerta, telefono, nombre_cliente, folio, motivo, creado_en';

const AlertaPendienteFilaSchema = z.object({
  id_alerta: z.number().int(),
  telefono: z.string(),
  nombre_cliente: z.string().nullable(),
  folio: z.number().int().nullable(),
  motivo: z.string(),
  creado_en: z.string(),
});

/** Fila que devuelve la función SQL `marcar_alerta_atendida`. */
const AlertaAtendidaFilaSchema = z.object({
  resultado: z.enum(['atendida', 'ya_atendida', 'no_encontrada']),
  atendida_en: z.string().nullable(),
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

    async leerPendientes() {
      // Usa el índice parcial alertas_atencion_pendientes (creado_en where atendida_en is null).
      const { data, error } = await cliente
        .from('alertas_atencion')
        .select(COLUMNAS_PENDIENTE)
        .is('atendida_en', null)
        .order('creado_en', { ascending: true })
        .order('id_alerta', { ascending: true });
      if (error) {
        throw new Error(`No se pudieron leer las alertas (código ${error.code ?? 'desconocido'})`);
      }
      return z
        .array(AlertaPendienteFilaSchema)
        .parse(data)
        .map((fila) => ({
          idAlerta: fila.id_alerta,
          telefono: fila.telefono,
          nombreCliente: fila.nombre_cliente,
          folio: fila.folio,
          motivo: fila.motivo,
          creadaEn: new Date(fila.creado_en),
        }));
    },

    async marcarAtendida(idAlerta, idEmpleado) {
      const { data, error } = await cliente.rpc('marcar_alerta_atendida', {
        p_id_alerta: idAlerta,
        p_id_empleado: idEmpleado,
      });
      if (error) {
        throw new Error(`Falló marcar_alerta_atendida (código ${error.code ?? 'desconocido'})`);
      }
      const [fila] = z.array(AlertaAtendidaFilaSchema).parse(data);
      if (!fila) throw new Error('marcar_alerta_atendida no devolvió ninguna fila');
      if (fila.resultado !== 'atendida') return { resultado: fila.resultado };
      if (fila.atendida_en === null) {
        throw new Error('marcar_alerta_atendida no devolvió la hora');
      }
      return { resultado: 'atendida', atendidaEn: new Date(fila.atendida_en) };
    },
  };
}
