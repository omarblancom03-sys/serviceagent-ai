import { ModoPagoSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { ConfiguracionRepo } from '../services/configuracion';

/*
 * Configuración del restaurante (supabase/migrations/*_modo_pago.sql): una sola fila, con el
 * nombre del empleado del último cambio. Se valida con zod al leerla.
 */
const FilaConfiguracionSchema = z.object({
  modo_pago: ModoPagoSchema,
  actualizado_en: z.string(),
  empleados: z.object({ nombre: z.string() }).nullable(),
});

/** Implementación de `ConfiguracionRepo` sobre Supabase. */
export function crearRepoConfiguracion(cliente: SupabaseClient): ConfiguracionRepo {
  return {
    async leer() {
      const { data, error } = await cliente
        .from('configuracion_restaurante')
        .select('modo_pago, actualizado_en, empleados(nombre)')
        .single();
      if (error) throw new Error(`No se pudo leer la configuración: ${error.message}`);
      const fila = FilaConfiguracionSchema.parse(data);
      return {
        modoPago: fila.modo_pago,
        actualizadoEn: new Date(fila.actualizado_en),
        actualizadoPor: fila.empleados?.nombre ?? null,
      };
    },

    async cambiarModoPago(modoPago, idEmpleado) {
      const { error } = await cliente.rpc('cambiar_modo_pago', {
        p_modo_pago: modoPago,
        p_id_empleado: idEmpleado,
      });
      if (error) throw new Error(`No se pudo cambiar el modo de pago: ${error.message}`);
    },
  };
}
