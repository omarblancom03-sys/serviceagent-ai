import { EmpleadoPublicoSchema, RolSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { EmpleadosRepo } from '../services/sesion';

/** Fila de `public.empleados` (supabase/migrations/*_crear_empleados.sql). */
const FilaEmpleadoSchema = z.object({
  id: z.uuid(),
  nombre: z.string(),
  rol: RolSchema,
  pin_hash: z.string(),
  activo: z.boolean(),
  intentos_fallidos: z.number().int(),
  bloqueado_hasta: z.string().nullable(),
});

/** Fila que devuelve la función SQL `registrar_intento_fallido`. */
const EstadoIntentosSchema = FilaEmpleadoSchema.pick({
  intentos_fallidos: true,
  bloqueado_hasta: true,
});

/** Implementación de `EmpleadosRepo` sobre Supabase. Valida con zod lo que devuelve la base. */
export function crearRepoEmpleados(cliente: SupabaseClient): EmpleadosRepo {
  return {
    async listarActivos() {
      const { data, error } = await cliente
        .from('empleados')
        .select('id, nombre, rol')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(`No se pudieron leer los empleados: ${error.message}`);
      return z.array(EmpleadoPublicoSchema).parse(data);
    },

    async buscarPorId(id) {
      const { data, error } = await cliente
        .from('empleados')
        .select('id, nombre, rol, pin_hash, activo, intentos_fallidos, bloqueado_hasta')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`No se pudo leer el empleado: ${error.message}`);
      if (!data) return null;

      const fila = FilaEmpleadoSchema.parse(data);
      return {
        id: fila.id,
        nombre: fila.nombre,
        rol: fila.rol,
        pinHash: fila.pin_hash,
        activo: fila.activo,
        intentosFallidos: fila.intentos_fallidos,
        bloqueadoHasta: fila.bloqueado_hasta ? new Date(fila.bloqueado_hasta) : null,
      };
    },

    async registrarIntentoFallido(id, { maxIntentos, minutosBloqueo }, ahora) {
      const { data, error } = await cliente.rpc('registrar_intento_fallido', {
        p_empleado_id: id,
        p_max_intentos: maxIntentos,
        p_minutos_bloqueo: minutosBloqueo,
        p_ahora: ahora.toISOString(),
      });
      if (error) throw new Error(`No se pudo registrar el intento: ${error.message}`);

      const [fila] = z.array(EstadoIntentosSchema).parse(data);
      if (!fila) return null;
      return {
        intentosFallidos: fila.intentos_fallidos,
        bloqueadoHasta: fila.bloqueado_hasta ? new Date(fila.bloqueado_hasta) : null,
      };
    },

    async reiniciarIntentos(id) {
      const { error } = await cliente
        .from('empleados')
        .update({ intentos_fallidos: 0, bloqueado_hasta: null })
        .eq('id', id);
      if (error) throw new Error(`No se pudieron reiniciar los intentos: ${error.message}`);
    },
  };
}
