import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from './env';

/**
 * Cliente de Supabase con la llave de servicio. Solo existe en la API: jamás en un frontend.
 * Se crea uno por petición porque las variables de entorno llegan con cada petición al Worker.
 */
export function crearClienteSupabase(
  env: Pick<Bindings, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
