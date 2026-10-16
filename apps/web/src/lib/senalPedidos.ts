import { CANAL_SENAL_PEDIDOS, EVENTO_SENAL_PEDIDOS } from '@serviceagent/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { estadoConexionDe, type EstadoConexion } from './cocina';

/*
 * Señal de Realtime "cambió un pedido" (D12, D47). Solo se escucha: no trae datos, y los pedidos
 * se piden a la API con la sesión del empleado. La llave anon es pública por diseño; con ella no
 * se puede leer ninguna tabla (D15).
 */

let cliente: SupabaseClient | null | undefined;

/** `null` si faltan `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY`: la pantalla vive del refresco. */
function clienteRealtime(): SupabaseClient | null {
  if (cliente !== undefined) return cliente;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const llave = import.meta.env.VITE_SUPABASE_ANON_KEY;
  cliente =
    url && llave
      ? createClient(url, llave, {
          // Sin Supabase Auth (usamos JWT propio, D12): nada se guarda en el navegador.
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        })
      : null;
  return cliente;
}

/** ¿Hay configuración de Realtime? Sin ella, la pantalla solo se refresca cada cierto tiempo. */
export function hayRealtime(): boolean {
  return clienteRealtime() !== null;
}

/**
 * Llama a `alCambiar` con cada señal y a `alCambiarConexion` cuando el canal se conecta o se cae
 * (Realtime reintenta solo). Devuelve la función para dejar de escuchar, o `null` si no hay
 * configuración de Realtime.
 */
export function escucharSenalPedidos(
  alCambiar: () => void,
  alCambiarConexion: (estado: EstadoConexion) => void,
): (() => void) | null {
  const realtime = clienteRealtime();
  if (!realtime) return null;

  const canal = realtime
    .channel(CANAL_SENAL_PEDIDOS)
    .on('broadcast', { event: EVENTO_SENAL_PEDIDOS }, () => alCambiar())
    .subscribe((estado) => alCambiarConexion(estadoConexionDe(estado)));

  return () => {
    void realtime.removeChannel(canal);
  };
}
