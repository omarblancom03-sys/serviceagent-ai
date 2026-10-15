import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Bindings } from './env';

/**
 * Esperas antes de cada reintento ante `PGRST303` "JWT issued at future" (D41): ~3 s en total.
 * El desfase observado se corrigió solo en menos de 2 s.
 */
export const ESPERAS_REINTENTO_MS = [300, 900, 1800] as const;

const esperarMs = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/**
 * Con las llaves `sb_secret_`, el gateway de Supabase cambia la llave por un JWT interno con la
 * hora de su reloj; si PostgREST va un poco atrás, lo rechaza con 401 `PGRST303` "JWT issued at
 * future" (supabase/supabase#49655). Se rechaza ANTES de ejecutar la consulta, así que reintentar
 * es seguro incluso en escrituras (`rpc`). Solo se lee una copia del cuerpo y solo si es 401.
 */
async function esJwtDelFuturo(respuesta: Response): Promise<boolean> {
  if (respuesta.status !== 401) return false;
  try {
    const cuerpo: unknown = await respuesta.clone().json();
    if (typeof cuerpo !== 'object' || cuerpo === null) return false;
    const { code, message } = cuerpo as { code?: unknown; message?: unknown };
    return code === 'PGRST303' && typeof message === 'string' && /issued at future/i.test(message);
  } catch {
    return false;
  }
}

/** Ruta de la petición para el log (`/rest/v1/extra`): dice qué tabla o función falló, sin la query. */
function rutaDe(entrada: Parameters<typeof fetch>[0]): string {
  const url =
    typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  try {
    return new URL(url).pathname;
  } catch {
    return '(ruta desconocida)';
  }
}

/**
 * `fetch` que reintenta solo ante `PGRST303` "JWT issued at future" (D41); cualquier otra respuesta
 * se devuelve tal cual. Si se agotan los reintentos, lo avisa en el log y devuelve el último 401, y
 * el repo lanza su error de siempre (→ 500). supabase-js manda el cuerpo como texto, así que se
 * puede reenviar. El 401 que se descarta se cierra para no dejar ocupada la conexión.
 */
export function crearFetchConReintento(
  fetchBase: typeof fetch = (entrada, init) => fetch(entrada, init),
  esperar: (ms: number) => Promise<void> = esperarMs,
): typeof fetch {
  return async (entrada, init) => {
    for (let intento = 0; ; intento++) {
      const respuesta = await fetchBase(entrada, init);
      if (!(await esJwtDelFuturo(respuesta))) return respuesta;

      const espera = ESPERAS_REINTENTO_MS[intento];
      const aviso = `Supabase: PGRST303 "JWT issued at future" en ${rutaDe(entrada)}`;
      if (espera === undefined) {
        console.warn(`${aviso}; se agotaron los ${ESPERAS_REINTENTO_MS.length} reintentos`);
        return respuesta;
      }
      console.warn(`${aviso}; reintento ${intento + 1}`);
      await respuesta.body?.cancel();
      await esperar(espera);
    }
  };
}

/**
 * Cliente de Supabase con la llave de servicio. Solo existe en la API: jamás en un frontend.
 * Se crea uno por petición porque las variables de entorno llegan con cada petición al Worker.
 */
export function crearClienteSupabase(
  env: Pick<Bindings, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: crearFetchConReintento() },
  });
}
