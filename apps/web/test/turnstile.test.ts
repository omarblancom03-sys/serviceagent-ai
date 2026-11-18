import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorTurnstile, ESPERA_TOKEN_MS, EsperaToken, leerLlaveSitio } from '../src/lib/turnstile';

describe('leerLlaveSitio', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['   ', null],
    [' 1x00000000000000000000AA ', '1x00000000000000000000AA'],
  ])('%j da %j', (valor, esperado) => {
    expect(leerLlaveSitio(valor)).toBe(esperado);
  });
});

describe('EsperaToken', () => {
  let espera: EsperaToken;
  beforeEach(() => {
    vi.useFakeTimers();
    espera = new EsperaToken();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('entrega el token que ya llegó, una sola vez', async () => {
    espera.recibir('tok-1');

    await expect(espera.tomar()).resolves.toBe('tok-1');
    // Ya se usó: el siguiente espera uno nuevo.
    const siguiente = espera.tomar();
    espera.recibir('tok-2');
    await expect(siguiente).resolves.toBe('tok-2');
  });

  it('si todavía no hay token, espera al siguiente', async () => {
    const promesa = espera.tomar();
    vi.advanceTimersByTime(5_000);
    espera.recibir('tok-1');

    await expect(promesa).resolves.toBe('tok-1');
  });

  it('el token que llega a quien esperaba no se queda guardado', async () => {
    const promesa = espera.tomar();
    espera.recibir('tok-1');
    await promesa;

    const otra = espera.tomar();
    vi.advanceTimersByTime(ESPERA_TOKEN_MS);
    await expect(otra).rejects.toBeInstanceOf(ErrorTurnstile);
  });

  it('un token vencido ya no se entrega', async () => {
    espera.recibir('tok-1');
    espera.vencer();

    const promesa = espera.tomar(1_000);
    vi.advanceTimersByTime(1_000);
    await expect(promesa).rejects.toMatchObject({ motivo: 'fallo' });
  });

  it('se rinde a los 60 s sin token', async () => {
    const promesa = espera.tomar();
    vi.advanceTimersByTime(ESPERA_TOKEN_MS - 1);
    espera.recibir('tarde');
    await expect(promesa).resolves.toBe('tarde');

    const otra = espera.tomar();
    vi.advanceTimersByTime(ESPERA_TOKEN_MS);
    await expect(otra).rejects.toMatchObject({ motivo: 'fallo' });
    expect(ESPERA_TOKEN_MS).toBe(60_000);
  });

  it('si el widget falla mientras se espera, rechaza en ese momento y queda en falla', async () => {
    const promesa = espera.tomar();
    espera.fallar();

    await expect(promesa).rejects.toMatchObject({ motivo: 'fallo' });
    expect(espera.enFalla).toBe(true);
  });

  it('una falla sin nadie esperando queda marcada hasta que llega un token o se descarta', async () => {
    espera.recibir('tok-1');
    espera.fallar();

    expect(espera.enFalla).toBe(true);
    await expect(espera.tomar()).rejects.toMatchObject({ motivo: 'fallo' });

    espera.descartar();
    expect(espera.enFalla).toBe(false);
    espera.fallar();
    espera.recibir('tok-2');
    expect(espera.enFalla).toBe(false);
    await expect(espera.tomar()).resolves.toBe('tok-2');
  });

  it('descartar olvida el token vigente', async () => {
    espera.recibir('tok-1');
    espera.descartar();

    const promesa = espera.tomar(10);
    vi.advanceTimersByTime(10);
    await expect(promesa).rejects.toBeInstanceOf(ErrorTurnstile);
  });

  it('una segunda espera cancela la primera: el token va a la más reciente', async () => {
    const primera = espera.tomar();
    const segunda = espera.tomar();
    espera.recibir('tok-1');

    await expect(primera).rejects.toBeInstanceOf(ErrorTurnstile);
    await expect(segunda).resolves.toBe('tok-1');
  });
});
