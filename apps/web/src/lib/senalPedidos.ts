import { CANAL_SENAL_PEDIDOS, EVENTO_SENAL_PEDIDOS } from '@serviceagent/shared';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { estadoConexionDe, type EstadoConexion } from './cocina';

/*
 * Señal de Realtime "cambió un pedido" (D12, D47). Solo se escucha: no trae datos, y los pedidos
 * se piden a la API con la sesión del empleado. La llave anon es pública por diseño; con ella no
 * se puede leer ninguna tabla (D15).
 */

let cliente: SupabaseClient | null | undefined;

/*
 * Un solo canal para toda la app, que se abre la primera vez y no se cierra: cada pantalla solo
 * agrega y quita su oyente. Si se cerrara al salir, volver en los ~100 ms que tarda en cerrarse
 * devolvería el canal que se está cerrando (`channel()` reutiliza el del mismo nombre) y la
 * pantalla se quedaría en "Conectando…".
 */
interface Oyente {
  alCambiar: () => void;
  alCambiarConexion: (estado: EstadoConexion) => void;
}
const oyentes = new Set<Oyente>();
let canal: RealtimeChannel | null = null;
let ultimoEstado: EstadoConexion | null = null;

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

  const oyente: Oyente = { alCambiar, alCambiarConexion };
  oyentes.add(oyente);
  if (canal === null) {
    canal = realtime
      .channel(CANAL_SENAL_PEDIDOS)
      .on('broadcast', { event: EVENTO_SENAL_PEDIDOS }, () => {
        oyentes.forEach((o) => o.alCambiar());
      })
      .subscribe((estado) => {
        const conexion = estadoConexionDe(estado);
        ultimoEstado = conexion;
        oyentes.forEach((o) => o.alCambiarConexion(conexion));
      });
  } else if (ultimoEstado !== null) {
    // El canal ya estaba abierto: la pantalla recibe su estado actual.
    alCambiarConexion(ultimoEstado);
  }

  return () => {
    oyentes.delete(oyente);
  };
}
