import {
  CANAL_SENAL_PEDIDOS,
  EVENTO_SENAL_ALERTAS,
  EVENTO_SENAL_PEDIDOS,
} from '@serviceagent/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { estadoConexionDe, type EstadoConexion } from './cocina';

/*
 * Señales de Realtime (D12, D47): "cambió un pedido" (evento `cambio`) y "cambió una alerta de
 * atención" (evento `alerta`, US-18, D59), las dos por el canal `pedidos`. Solo se escuchan: no
 * traen datos, y todo se pide a la API con la sesión del empleado. Llave pública de Supabase (cuál
 * va: docs/despliegue.md); con ella no se puede leer ninguna tabla (D15).
 */

let cliente: SupabaseClient | null | undefined;

/** Quien escucha: cada pantalla pide solo la señal que le importa. */
export interface OyenteSenal {
  alCambiar?: () => void;
  alAlerta?: () => void;
  alCambiarConexion: (estado: EstadoConexion) => void;
}

/** Lo único del cliente de Supabase que se usa: abrir un canal (así el test usa uno falso). */
export type ClienteCanal = Pick<SupabaseClient, 'channel'>;

/**
 * Un solo canal para toda la app, que se abre la primera vez y no se cierra: cada pantalla solo
 * agrega y quita su oyente. Si se cerrara al salir, volver en los ~100 ms que tarda en cerrarse
 * devolvería el canal que se está cerrando (`channel()` reutiliza el del mismo nombre) y la
 * pantalla se quedaría en "Conectando…". Los dos eventos se registran al abrirlo, siempre: un
 * admin que abre `/cocina` y luego `/caja` ya tiene el canal conectado y no se le podría agregar
 * `alerta` después.
 */
export function crearCentralSenales(realtime: ClienteCanal) {
  const oyentes = new Set<OyenteSenal>();
  let abierto = false;
  let ultimoEstado: EstadoConexion | null = null;

  function abrir() {
    realtime
      .channel(CANAL_SENAL_PEDIDOS)
      .on('broadcast', { event: EVENTO_SENAL_PEDIDOS }, () => {
        oyentes.forEach((o) => o.alCambiar?.());
      })
      .on('broadcast', { event: EVENTO_SENAL_ALERTAS }, () => {
        oyentes.forEach((o) => o.alAlerta?.());
      })
      .subscribe((estado) => {
        const conexion = estadoConexionDe(estado);
        ultimoEstado = conexion;
        oyentes.forEach((o) => o.alCambiarConexion(conexion));
      });
    abierto = true;
  }

  return {
    /** Agrega el oyente (abre el canal si hace falta) y devuelve la función para quitarlo. */
    escuchar(oyente: OyenteSenal): () => void {
      oyentes.add(oyente);
      if (!abierto) abrir();
      // El canal ya estaba abierto: la pantalla recibe su estado actual.
      else if (ultimoEstado !== null) oyente.alCambiarConexion(ultimoEstado);
      return () => {
        oyentes.delete(oyente);
      };
    },
  };
}

let central: ReturnType<typeof crearCentralSenales> | null = null;

/**
 * Cliente de Realtime con la URL y la llave públicas de Supabase, o `null` si falta alguna o si
 * `createClient` las rechaza (solo pasa con una URL sin forma de URL). Con `null` la pantalla
 * funciona igual, con el refresco de 30 s, en lugar de quedarse en blanco. Una URL bien formada
 * pero equivocada o una llave mala no truenan aquí: el canal no conecta y sale "Sin conexión en vivo".
 */
export function crearClienteRealtime(
  url: string | undefined,
  llave: string | undefined,
  crear: typeof createClient = createClient,
): SupabaseClient | null {
  if (!url || !llave) return null;
  try {
    return crear(url, llave, {
      // Sin Supabase Auth (usamos JWT propio, D12): nada se guarda en el navegador.
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  } catch {
    // Sin la URL ni la llave en el aviso: solo que la configuración no sirve.
    console.warn(
      'Realtime desactivado: VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY no son válidas.',
    );
    return null;
  }
}

/** Un solo cliente para toda la app; `null` si no hay configuración válida (vive del refresco). */
function clienteRealtime(): SupabaseClient | null {
  if (cliente !== undefined) return cliente;
  cliente = crearClienteRealtime(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  return cliente;
}

/** ¿Hay configuración de Realtime? Sin ella, la pantalla solo se refresca cada cierto tiempo. */
export function hayRealtime(): boolean {
  return clienteRealtime() !== null;
}

function escuchar(oyente: OyenteSenal): (() => void) | null {
  const realtime = clienteRealtime();
  if (!realtime) return null;
  central ??= crearCentralSenales(realtime);
  return central.escuchar(oyente);
}

/**
 * Llama a `alCambiar` con cada señal de pedidos (nunca con las de alertas) y a `alCambiarConexion`
 * cuando el canal se conecta o se cae (Realtime reintenta solo). Devuelve la función para dejar de
 * escuchar, o `null` si no hay configuración de Realtime.
 */
export function escucharSenalPedidos(
  alCambiar: () => void,
  alCambiarConexion: (estado: EstadoConexion) => void,
): (() => void) | null {
  return escuchar({ alCambiar, alCambiarConexion });
}

/** Igual que `escucharSenalPedidos`, pero con la señal de alertas de atención (US-18). */
export function escucharSenalAlertas(
  alAlerta: () => void,
  alCambiarConexion: (estado: EstadoConexion) => void,
): (() => void) | null {
  return escuchar({ alAlerta, alCambiarConexion });
}
