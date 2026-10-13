import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoChat } from '../src/lib/repoChat';

/** Cliente de Supabase falso: solo `rpc`, con la respuesta que diga cada test. */
function clienteRpc(respuesta: {
  data: unknown;
  error: { code?: string; message: string } | null;
}) {
  const llamadas: { funcion: string; params: unknown }[] = [];
  const cliente = {
    rpc: async (funcion: string, params: unknown) => {
      llamadas.push({ funcion, params });
      return respuesta;
    },
  } as unknown as SupabaseClient;
  return { repo: crearRepoChat(cliente), llamadas };
}

const id = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const ahora = new Date('2026-10-12T20:00:00.000Z');

describe('repoChat sobre Supabase', () => {
  it('abrir llama a abrir_conversacion_chat y lee abierta o tope_alcanzado', async () => {
    const abierta = clienteRpc({
      data: [{ resultado: 'abierta', conversacion_id: id }],
      error: null,
    });
    expect(await abierta.repo.abrir(3, ahora)).toEqual({ resultado: 'abierta', id });
    expect(abierta.llamadas).toEqual([
      {
        funcion: 'abrir_conversacion_chat',
        params: { p_tope_diario: 3, p_ahora: '2026-10-12T20:00:00.000Z' },
      },
    ]);

    const tope = clienteRpc({
      data: [{ resultado: 'tope_alcanzado', conversacion_id: null }],
      error: null,
    });
    expect(await tope.repo.abrir(3, ahora)).toEqual({ resultado: 'tope_alcanzado' });
  });

  it('registrar devuelve el conteo y el chat_id, o el motivo del rechazo', async () => {
    const ok = clienteRpc({
      data: [{ resultado: 'registrado', mensajes_usados: 4, chat_id_retell: 'chat_1' }],
      error: null,
    });
    expect(await ok.repo.registrarMensaje(id, 30, ahora)).toEqual({
      resultado: 'registrado',
      mensajesUsados: 4,
      chatIdRetell: 'chat_1',
    });
    expect(ok.llamadas[0]).toEqual({
      funcion: 'registrar_mensaje_chat',
      params: { p_conversacion_id: id, p_limite_mensajes: 30, p_ahora: ahora.toISOString() },
    });

    for (const [resultado, usados] of [
      ['no_encontrada', null],
      ['terminada', 3],
      ['limite_alcanzado', 30],
    ] as const) {
      const r = clienteRpc({
        data: [{ resultado, mensajes_usados: usados, chat_id_retell: null }],
        error: null,
      });
      expect(await r.repo.registrarMensaje(id, 30, ahora)).toEqual({ resultado });
    }
  });

  it('asociar, devolver y terminar leen lo que devuelve su función', async () => {
    const asociar = clienteRpc({ data: true, error: null });
    expect(await asociar.repo.asociarChatRetell(id, 'chat_1')).toBe(true);
    expect(asociar.llamadas[0]).toEqual({
      funcion: 'asociar_chat_retell',
      params: { p_conversacion_id: id, p_chat_id: 'chat_1' },
    });

    expect(await clienteRpc({ data: 2, error: null }).repo.devolverMensaje(id)).toBe(2);
    expect(await clienteRpc({ data: null, error: null }).repo.devolverMensaje(id)).toBeNull();
    expect(await clienteRpc({ data: false, error: null }).repo.terminar(id, ahora)).toBe(false);
  });

  it('un error de Supabase lanza solo con el código, sin el mensaje ni los parámetros', async () => {
    const { repo } = clienteRpc({
      data: null,
      error: { code: '23514', message: 'Failing row contains (chat_secreto)' },
    });

    await expect(repo.asociarChatRetell(id, 'chat_secreto')).rejects.toThrow(
      'Falló asociar_chat_retell (código 23514)',
    );
    await expect(repo.asociarChatRetell(id, 'chat_secreto')).rejects.not.toThrow(/secreto/);
  });

  it.each([
    ['un resultado desconocido', [{ resultado: 'otro', conversacion_id: null }]],
    ['abierta sin id', [{ resultado: 'abierta', conversacion_id: null }]],
    ['ninguna fila', []],
  ])('abrir con %s lanza un error', async (_, data) => {
    await expect(clienteRpc({ data, error: null }).repo.abrir(3, ahora)).rejects.toThrow();
  });
});
