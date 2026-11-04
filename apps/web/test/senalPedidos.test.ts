import type { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  crearCentralSenales,
  crearClienteRealtime,
  type ClienteCanal,
} from '../src/lib/senalPedidos';

/**
 * Cliente de Realtime falso: anota los canales que se abren y los eventos registrados, y deja que
 * el test mande una señal (`emitir`) o un cambio de conexión (`conectar`).
 */
function realtimeFalso() {
  const canales: string[] = [];
  const eventos = new Map<string, () => void>();
  let alSuscribir: ((estado: string) => void) | null = null;
  const canal = {
    on(_tipo: string, filtro: { event: string }, callback: () => void) {
      eventos.set(filtro.event, callback);
      return canal;
    },
    subscribe(callback: (estado: string) => void) {
      alSuscribir = callback;
      return canal;
    },
  };
  // Un doble con solo `channel`: es lo único que usa la central.
  const cliente = {
    channel(nombre: string) {
      canales.push(nombre);
      return canal;
    },
  } as unknown as ClienteCanal;
  return {
    cliente,
    canales,
    eventos,
    emitir: (evento: string) => eventos.get(evento)?.(),
    conectar: (estado: string) => alSuscribir?.(estado),
  };
}

describe('crearCentralSenales (US-18): pedidos y alertas por el mismo canal', () => {
  it('abre un solo canal `pedidos` con los dos eventos, aunque escuchen dos pantallas', () => {
    const rt = realtimeFalso();
    const central = crearCentralSenales(rt.cliente);
    central.escuchar({ alCambiar: () => {}, alCambiarConexion: () => {} });
    central.escuchar({ alAlerta: () => {}, alCambiarConexion: () => {} });
    expect(rt.canales).toEqual(['pedidos']);
    expect([...rt.eventos.keys()].sort()).toEqual(['alerta', 'cambio']);
  });

  it('la señal de alerta no llega a quien escucha pedidos (cocina no recarga de más)', () => {
    const rt = realtimeFalso();
    const central = crearCentralSenales(rt.cliente);
    const alCambiar = vi.fn();
    const alAlerta = vi.fn();
    central.escuchar({ alCambiar, alCambiarConexion: () => {} });
    central.escuchar({ alAlerta, alCambiarConexion: () => {} });

    rt.emitir('alerta');
    expect(alAlerta).toHaveBeenCalledTimes(1);
    expect(alCambiar).not.toHaveBeenCalled();

    rt.emitir('cambio');
    expect(alCambiar).toHaveBeenCalledTimes(1);
    expect(alAlerta).toHaveBeenCalledTimes(1);
  });

  it('los dos reciben los cambios de conexión; quien llega tarde recibe el estado actual', () => {
    const rt = realtimeFalso();
    const central = crearCentralSenales(rt.cliente);
    const conexionPedidos = vi.fn();
    central.escuchar({ alCambiar: () => {}, alCambiarConexion: conexionPedidos });
    rt.conectar('SUBSCRIBED');
    expect(conexionPedidos).toHaveBeenLastCalledWith('en_vivo');

    // Un admin que ya tenía /cocina abierta entra a /caja: el canal ya estaba conectado.
    const conexionAlertas = vi.fn();
    central.escuchar({ alAlerta: () => {}, alCambiarConexion: conexionAlertas });
    expect(conexionAlertas).toHaveBeenCalledWith('en_vivo');

    rt.conectar('CHANNEL_ERROR');
    expect(conexionPedidos).toHaveBeenLastCalledWith('reconectando');
    expect(conexionAlertas).toHaveBeenLastCalledWith('reconectando');
  });

  it('al dejar de escuchar ya no llegan señales y el canal no se vuelve a abrir', () => {
    const rt = realtimeFalso();
    const central = crearCentralSenales(rt.cliente);
    const alAlerta = vi.fn();
    const dejar = central.escuchar({ alAlerta, alCambiarConexion: () => {} });
    dejar();
    rt.emitir('alerta');
    expect(alAlerta).not.toHaveBeenCalled();

    central.escuchar({ alAlerta, alCambiarConexion: () => {} });
    rt.emitir('alerta');
    expect(alAlerta).toHaveBeenCalledTimes(1);
    expect(rt.canales).toEqual(['pedidos']);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crearClienteRealtime (US-10-T1)', () => {
  it('sin URL o sin llave no hay cliente: la pantalla vive del refresco', () => {
    expect(crearClienteRealtime(undefined, 'llave')).toBeNull();
    expect(crearClienteRealtime('https://abc.supabase.co', undefined)).toBeNull();
    expect(crearClienteRealtime('', '')).toBeNull();
  });

  it('con una URL mal escrita no truena: devuelve null y avisa sin mostrar los valores', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(crearClienteRealtime('htps//mal escrita', 'sb_publishable_xyz')).toBeNull();
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(aviso.mock.calls)).not.toMatch(/mal escrita|sb_publishable_xyz/);
  });

  it('si createClient lanza un error, también devuelve null', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Un doble del tipo de createClient: solo importa que lance (no se usa su resultado).
    const crear = (() => {
      throw new Error('Invalid supabaseUrl');
    }) as unknown as typeof createClient;
    expect(crearClienteRealtime('https://abc.supabase.co', 'llave', crear)).toBeNull();
  });

  it('con URL y llave válidas crea el cliente sin guardar la sesión en el navegador', () => {
    const crear = vi.fn(() => ({ cliente: true }));
    const cliente = crearClienteRealtime(
      'https://abc.supabase.co',
      'sb_publishable_xyz',
      // Un doble que regresa un objeto cualquiera en lugar de un SupabaseClient real.
      crear as unknown as typeof createClient,
    );
    expect(cliente).toEqual({ cliente: true });
    expect(crear).toHaveBeenCalledWith('https://abc.supabase.co', 'sb_publishable_xyz', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  });
});
