import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoAlertas } from '../src/lib/repoAlertas';

type Respuesta = { data: unknown; error: { code?: string; message: string } | null };

/**
 * Cliente de Supabase falso: `rpc` y la cadena `from().select().is().order().order()`, con la
 * respuesta que diga cada test. Anota lo que se pidió para revisarlo.
 */
function clienteFalso(respuesta: Respuesta) {
  const llamadas: unknown[][] = [];
  const consulta = {
    select: (columnas: string) => (llamadas.push(['select', columnas]), consulta),
    is: (columna: string, valor: unknown) => (llamadas.push(['is', columna, valor]), consulta),
    order: (columna: string, opciones: unknown) => {
      llamadas.push(['order', columna, opciones]);
      return Object.assign(Promise.resolve(respuesta), consulta);
    },
  };
  const cliente = {
    from: (tabla: string) => (llamadas.push(['from', tabla]), consulta),
    rpc: async (funcion: string, params: unknown) => {
      llamadas.push(['rpc', funcion, params]);
      return respuesta;
    },
  } as unknown as SupabaseClient;
  return { repo: crearRepoAlertas(cliente), llamadas };
}

describe('repoAlertas sobre Supabase (US-18 P1-B)', () => {
  it('leerPendientes pide solo las pendientes, en orden y sin chat_id_retell', async () => {
    const { repo, llamadas } = clienteFalso({
      data: [
        {
          id_alerta: 7,
          telefono: '6145550101',
          nombre_cliente: null,
          folio: 1024,
          motivo: 'Quiere factura.',
          creado_en: '2026-10-26T18:00:00+00:00',
        },
      ],
      error: null,
    });
    expect(await repo.leerPendientes()).toEqual([
      {
        idAlerta: 7,
        telefono: '6145550101',
        nombreCliente: null,
        folio: 1024,
        motivo: 'Quiere factura.',
        creadaEn: new Date('2026-10-26T18:00:00Z'),
      },
    ]);
    expect(llamadas[0]).toEqual(['from', 'alertas_atencion']);
    expect(String(llamadas[1]?.[1])).not.toContain('chat_id');
    expect(llamadas.slice(2)).toEqual([
      ['is', 'atendida_en', null],
      ['order', 'creado_en', { ascending: true }],
      ['order', 'id_alerta', { ascending: true }],
    ]);
  });

  it('leerPendientes falla solo con el código de Postgres', async () => {
    const { repo } = clienteFalso({ data: null, error: { code: '42501', message: 'secreto' } });
    await expect(repo.leerPendientes()).rejects.toThrow(/^No se pudieron leer.*42501\)$/);
  });

  it('marcarAtendida llama a marcar_alerta_atendida y lee sus tres resultados', async () => {
    const id = '00000000-0000-4000-8000-000000000002';
    const atendida = clienteFalso({
      data: [{ resultado: 'atendida', atendida_en: '2026-10-26T18:05:00+00:00' }],
      error: null,
    });
    expect(await atendida.repo.marcarAtendida(7, id)).toEqual({
      resultado: 'atendida',
      atendidaEn: new Date('2026-10-26T18:05:00Z'),
    });
    expect(atendida.llamadas).toEqual([
      ['rpc', 'marcar_alerta_atendida', { p_id_alerta: 7, p_id_empleado: id }],
    ]);

    for (const resultado of ['ya_atendida', 'no_encontrada'] as const) {
      const otro = clienteFalso({ data: [{ resultado, atendida_en: null }], error: null });
      expect(await otro.repo.marcarAtendida(7, id)).toEqual({ resultado });
    }
  });

  it('marcarAtendida falla si la base no responde o responde algo inesperado', async () => {
    const id = '00000000-0000-4000-8000-000000000002';
    const conError = clienteFalso({ data: null, error: { code: '08006', message: 'x' } });
    await expect(conError.repo.marcarAtendida(7, id)).rejects.toThrow(/código 08006/);
    const vacia = clienteFalso({ data: [], error: null });
    await expect(vacia.repo.marcarAtendida(7, id)).rejects.toThrow(/ninguna fila/);
    const sinHora = clienteFalso({
      data: [{ resultado: 'atendida', atendida_en: null }],
      error: null,
    });
    await expect(sinHora.repo.marcarAtendida(7, id)).rejects.toThrow(/la hora/);
  });
});
