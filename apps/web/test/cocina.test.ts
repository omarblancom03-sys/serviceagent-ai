import type { TicketCocina } from '@serviceagent/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi } from '../src/lib/api';
import {
  ESPERA_AGRUPAR_SENALES_MS,
  ESPERA_MAXIMA_SENALES_MS,
  crearRecargador,
  estadoConexionDe,
  foliosNuevos,
  lineaDe,
  mensajeErrorCocina,
  separarRenglones,
} from '../src/lib/cocina';

const ticket = (folio: number, renglones: TicketCocina['renglones'] = []): TicketCocina => ({
  folio,
  folioTexto: `#${folio}`,
  nombreCliente: 'María José',
  estado: 'en_cola',
  enColaDesde: '2026-10-15T18:00:00.000Z',
  renglones,
});

describe('foliosNuevos', () => {
  it('en la primera carga no resalta nada', () => {
    expect(foliosNuevos(null, [ticket(1001), ticket(1002)])).toEqual([]);
  });

  it('resalta solo los que no estaban antes', () => {
    expect(foliosNuevos([ticket(1001)], [ticket(1001), ticket(1003), ticket(1004)])).toEqual([
      1003, 1004,
    ]);
  });

  it('un pedido que se fue de la lista no cuenta como nuevo', () => {
    expect(foliosNuevos([ticket(1001), ticket(1002)], [ticket(1002)])).toEqual([]);
  });
});

describe('lineaDe', () => {
  it('platillo con variante, ingredientes quitados y extras por unidad', () => {
    expect(
      lineaDe({
        tipo: 'platillo',
        cantidad: 2,
        nombre: 'T-Bone 450 gr',
        variante: null,
        sinIngredientes: ['Cebolla asada'],
        extras: [{ nombre: 'Espuelas (camarones)', cantidad: 1 }],
      }),
    ).toEqual({
      principal: '2 × T-Bone 450 gr',
      detalles: ['Sin cebolla asada', '+ 1 Espuelas (camarones) c/u'],
    });
  });

  it('con una sola unidad no dice "c/u" y muestra la variante entre paréntesis', () => {
    expect(
      lineaDe({
        tipo: 'platillo',
        cantidad: 1,
        nombre: 'Limonada mineral',
        variante: 'Vaso 500 ml',
        sinIngredientes: [],
        extras: [{ nombre: 'Espuelas (camarones)', cantidad: 2 }],
      }),
    ).toEqual({
      principal: '1 × Limonada mineral (Vaso 500 ml)',
      detalles: ['+ 2 Espuelas (camarones)'],
    });
  });

  it('extra suelto: solo cantidad y nombre', () => {
    expect(lineaDe({ tipo: 'extra', cantidad: 3, nombre: 'Totopos' })).toEqual({
      principal: '3 × Totopos',
      detalles: [],
    });
  });
});

describe('separarRenglones', () => {
  it('los extras sueltos van aparte, en el orden en que se pidieron', () => {
    const { platillos, aparte } = separarRenglones(
      ticket(1001, [
        {
          tipo: 'platillo',
          cantidad: 1,
          nombre: 'Cowboy',
          variante: null,
          sinIngredientes: [],
          extras: [],
        },
        { tipo: 'extra', cantidad: 1, nombre: 'Totopos' },
        { tipo: 'extra', cantidad: 2, nombre: 'BBQ' },
      ]),
    );
    expect(platillos.map((l) => l.principal)).toEqual(['1 × Cowboy']);
    expect(aparte.map((l) => l.principal)).toEqual(['1 × Totopos', '2 × BBQ']);
  });
});

describe('estadoConexionDe', () => {
  it.each([
    ['SUBSCRIBED', 'en_vivo'],
    ['CHANNEL_ERROR', 'reconectando'],
    ['TIMED_OUT', 'reconectando'],
    ['CLOSED', 'reconectando'],
  ])('%s → %s', (estado, esperado) => {
    expect(estadoConexionDe(estado)).toBe(esperado);
  });
});

describe('mensajeErrorCocina', () => {
  it('403: el usuario no tiene acceso', () => {
    expect(mensajeErrorCocina(new ErrorApi(403, null))).toBe(
      'Tu usuario no tiene acceso a cocina.',
    );
  });

  it('cualquier otro error: sin códigos técnicos y avisa que reintenta sola', () => {
    for (const error of [new ErrorApi(500, null), new TypeError('Failed to fetch')]) {
      const mensaje = mensajeErrorCocina(error);
      expect(mensaje).toMatch(/reintent|vuelve a intentar/i);
      expect(mensaje).not.toMatch(/\d{3}|fetch/i);
    }
  });
});

describe('crearRecargador', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Una carga que termina cuando el test llama a `terminar()`, para simular la API tardando. */
  function cargaControlada() {
    const pendientes: (() => void)[] = [];
    const cargar = vi.fn(
      () =>
        new Promise<void>((resolver) => {
          pendientes.push(resolver);
        }),
    );
    const terminar = async () => {
      pendientes.shift()?.();
      await vi.advanceTimersByTimeAsync(0);
    };
    return { cargar, terminar };
  }

  it('varias señales juntas se atienden con una sola petición', async () => {
    const cargar = vi.fn(() => Promise.resolve());
    const recarga = crearRecargador(cargar);
    recarga.senal();
    await vi.advanceTimersByTimeAsync(100);
    recarga.senal();
    await vi.advanceTimersByTimeAsync(100);
    recarga.senal();
    expect(cargar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ESPERA_AGRUPAR_SENALES_MS);
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('con señales continuas pide la lista a más tardar 2 s después de la primera', async () => {
    const cargar = vi.fn(() => Promise.resolve());
    const recarga = crearRecargador(cargar);
    // Una señal cada 300 ms: sin tope, la espera de 400 ms se reiniciaría para siempre.
    for (let t = 0; t < ESPERA_MAXIMA_SENALES_MS; t += 300) {
      recarga.senal();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(cargar).toHaveBeenCalledTimes(1);
  });

  it('después de atender un grupo, la siguiente señal vuelve a esperar desde cero', async () => {
    const cargar = vi.fn(() => Promise.resolve());
    const recarga = crearRecargador(cargar);
    recarga.senal();
    await vi.advanceTimersByTimeAsync(ESPERA_AGRUPAR_SENALES_MS);
    recarga.senal();
    await vi.advanceTimersByTimeAsync(ESPERA_AGRUPAR_SENALES_MS - 1);
    expect(cargar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('nunca hay dos peticiones a la vez; lo que llega mientras carga se pide una vez al terminar', async () => {
    const { cargar, terminar } = cargaControlada();
    const recarga = crearRecargador(cargar);
    void recarga.recargar();
    void recarga.recargar();
    void recarga.recargar();
    expect(cargar).toHaveBeenCalledTimes(1);
    await terminar();
    expect(cargar).toHaveBeenCalledTimes(2);
    await terminar();
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('se pone al día al volver la conexión, no mientras sigue en vivo', async () => {
    const cargar = vi.fn(() => Promise.resolve());
    const recarga = crearRecargador(cargar);
    recarga.conexion('en_vivo');
    await vi.advanceTimersByTimeAsync(0);
    recarga.conexion('en_vivo');
    await vi.advanceTimersByTimeAsync(0);
    expect(cargar).toHaveBeenCalledTimes(1);
    recarga.conexion('reconectando');
    await vi.advanceTimersByTimeAsync(0);
    expect(cargar).toHaveBeenCalledTimes(1);
    recarga.conexion('en_vivo');
    await vi.advanceTimersByTimeAsync(0);
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it('al detenerse no pide nada más, ni lo que estaba agrupando', async () => {
    const cargar = vi.fn(() => Promise.resolve());
    const recarga = crearRecargador(cargar);
    recarga.senal();
    recarga.detener();
    await vi.advanceTimersByTimeAsync(ESPERA_MAXIMA_SENALES_MS);
    await recarga.recargar();
    recarga.conexion('en_vivo');
    expect(cargar).not.toHaveBeenCalled();
  });
});
