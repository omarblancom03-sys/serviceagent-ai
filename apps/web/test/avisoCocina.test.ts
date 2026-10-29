import type { EstadoCocina, TicketCocina } from '@serviceagent/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  AVISO_SONIDO,
  contarPedidos,
  crearAvisoSonoro,
  debeSonar,
  textoBotonSonido,
  textoContador,
  type Sonador,
} from '../src/lib/avisoCocina';
import { foliosNuevos } from '../src/lib/cocina';

const ticket = (folio: number, estado: EstadoCocina = 'en_cola'): TicketCocina => ({
  folio,
  folioTexto: `#${folio}`,
  nombreCliente: 'María José',
  estado,
  enColaDesde: '2026-10-15T18:00:00.000Z',
  renglones: [],
});

/** Sonador falso: nunca toca el audio del navegador. */
function sonadorFalso({ disponible = true, activa = true, suena = true } = {}) {
  const sonador = {
    disponible,
    activar: vi.fn(() => Promise.resolve(activa)),
    sonar: vi.fn(() => suena),
    cerrar: vi.fn(),
  } satisfies Sonador;
  const alCambiar = vi.fn();
  const aviso = crearAvisoSonoro(sonador, alCambiar);
  return { sonador, alCambiar, aviso };
}

describe('contarPedidos y textoContador', () => {
  it('sin pedidos: todo en cero', () => {
    expect(contarPedidos([])).toEqual({ enCola: 0, preparando: 0 });
    expect(textoContador(contarPedidos([]))).toBe('En cola: 0 · Preparando: 0');
  });

  it('separa los que están en cola de los que se preparan', () => {
    const conteo = contarPedidos([
      ticket(1001, 'preparando'),
      ticket(1002),
      ticket(1003),
      ticket(1004, 'preparando'),
      ticket(1005),
    ]);
    expect(conteo).toEqual({ enCola: 3, preparando: 2 });
    expect(textoContador(conteo)).toBe('En cola: 3 · Preparando: 2');
  });
});

describe('textos del sonido', () => {
  it('pide tocar la pantalla mientras está bloqueado y avisa del silencio', () => {
    expect(AVISO_SONIDO.bloqueado).toBe('Toca la pantalla para activar el sonido');
    expect(AVISO_SONIDO.silenciado).toMatch(/silenciado/i);
    expect(AVISO_SONIDO.activo).toBeNull();
  });

  it('el botón dice lo que va a hacer', () => {
    expect(textoBotonSonido('activo')).toBe('Silenciar aviso');
    expect(textoBotonSonido('bloqueado')).toBe('Silenciar aviso');
    expect(textoBotonSonido('silenciado')).toBe('Activar sonido');
  });
});

describe('debeSonar', () => {
  it('suena si llega al menos un pedido en cola', () => {
    expect(debeSonar([ticket(1001, 'preparando'), ticket(1002)])).toBe(true);
  });

  it('no suena por un pedido que regresa en preparando (Deshacer de Terminado) ni sin nuevos', () => {
    expect(debeSonar([ticket(1001, 'preparando')])).toBe(false);
    expect(debeSonar([])).toBe(false);
  });
});

describe('crearAvisoSonoro', () => {
  it('empieza bloqueado y no suena hasta que tocan la pantalla', () => {
    const { sonador, aviso } = sonadorFalso();
    expect(aviso.estado()).toBe('bloqueado');
    aviso.pedidosNuevos([ticket(1001)]);
    expect(sonador.sonar).not.toHaveBeenCalled();
  });

  it('tras el primer toque queda activo y suena una sola vez por tanda', async () => {
    const { sonador, aviso } = sonadorFalso();
    await aviso.interaccion();
    expect(aviso.estado()).toBe('activo');
    aviso.pedidosNuevos([ticket(1001), ticket(1002), ticket(1003)]);
    expect(sonador.sonar).toHaveBeenCalledTimes(1);
    aviso.pedidosNuevos([ticket(1004)]);
    expect(sonador.sonar).toHaveBeenCalledTimes(2);
  });

  it('no suena en la primera carga ni en una recarga sin pedidos nuevos', async () => {
    const { sonador, aviso } = sonadorFalso();
    await aviso.interaccion();
    const lista = [ticket(1001), ticket(1002)];
    aviso.pedidosNuevos(lista.filter((t) => foliosNuevos(null, lista).includes(t.folio)));
    aviso.pedidosNuevos([]);
    expect(sonador.sonar).not.toHaveBeenCalled();
  });

  it('silenciado no suena y se puede volver a activar', async () => {
    const { sonador, aviso } = sonadorFalso();
    await aviso.interaccion();
    aviso.alternarSilencio();
    expect(aviso.estado()).toBe('silenciado');
    aviso.pedidosNuevos([ticket(1001)]);
    expect(sonador.sonar).not.toHaveBeenCalled();
    aviso.alternarSilencio();
    expect(aviso.estado()).toBe('activo');
    aviso.pedidosNuevos([ticket(1002)]);
    expect(sonador.sonar).toHaveBeenCalledTimes(1);
  });

  it('silenciar antes del primer toque se ve en pantalla y sigue silenciado al tocar', async () => {
    const { sonador, aviso } = sonadorFalso();
    aviso.alternarSilencio();
    expect(aviso.estado()).toBe('silenciado');
    await aviso.interaccion();
    expect(aviso.estado()).toBe('silenciado');
    aviso.pedidosNuevos([ticket(1001)]);
    expect(sonador.sonar).not.toHaveBeenCalled();
    aviso.alternarSilencio();
    expect(aviso.estado()).toBe('activo');
  });

  it('si el navegador no deja activar, sigue bloqueado y lo reintenta en el siguiente toque', async () => {
    const { sonador, aviso } = sonadorFalso({ activa: false });
    await aviso.interaccion();
    expect(aviso.estado()).toBe('bloqueado');
    sonador.activar.mockRejectedValueOnce(new Error('NotAllowedError'));
    await aviso.interaccion();
    expect(aviso.estado()).toBe('bloqueado');
    sonador.activar.mockResolvedValueOnce(true);
    await aviso.interaccion();
    expect(aviso.estado()).toBe('activo');
    await aviso.interaccion();
    expect(sonador.activar).toHaveBeenCalledTimes(3);
  });

  it('si el audio se suspende (no pudo sonar), vuelve a pedir que toquen la pantalla', async () => {
    const { sonador, aviso } = sonadorFalso({ suena: false });
    await aviso.interaccion();
    aviso.pedidosNuevos([ticket(1001)]);
    expect(sonador.sonar).toHaveBeenCalledTimes(1);
    expect(aviso.estado()).toBe('bloqueado');
  });

  it('sin Web Audio queda en sin_audio y nunca intenta sonar', async () => {
    const { sonador, aviso } = sonadorFalso({ disponible: false });
    expect(aviso.estado()).toBe('sin_audio');
    await aviso.interaccion();
    aviso.alternarSilencio();
    aviso.pedidosNuevos([ticket(1001)]);
    expect(aviso.estado()).toBe('sin_audio');
    expect(sonador.activar).not.toHaveBeenCalled();
    expect(sonador.sonar).not.toHaveBeenCalled();
  });

  it('avisa a la pantalla solo cuando el estado cambia', async () => {
    const { alCambiar, aviso } = sonadorFalso();
    await aviso.interaccion();
    await aviso.interaccion();
    aviso.pedidosNuevos([ticket(1001)]);
    aviso.alternarSilencio();
    expect(alCambiar.mock.calls).toEqual([['activo'], ['silenciado']]);
  });

  it('al salir de la pantalla cierra el audio', async () => {
    const { sonador, aviso } = sonadorFalso();
    await aviso.interaccion();
    expect(sonador.cerrar).not.toHaveBeenCalled();
    aviso.cerrar();
    expect(sonador.cerrar).toHaveBeenCalledTimes(1);
  });
});
