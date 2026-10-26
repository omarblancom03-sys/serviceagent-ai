import type { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearClienteRealtime } from '../src/lib/senalPedidos';

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
