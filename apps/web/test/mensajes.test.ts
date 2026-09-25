import { describe, expect, it } from 'vitest';
import { mensajeErrorLogin } from '../src/auth/mensajes';

describe('mensajeErrorLogin', () => {
  it('PIN incorrecto con los intentos que quedan', () => {
    expect(mensajeErrorLogin(401, { error: 'PIN incorrecto.', intentosRestantes: 3 })).toBe(
      'PIN incorrecto. Te quedan 3 intentos.',
    );
    expect(mensajeErrorLogin(401, { error: 'PIN incorrecto.', intentosRestantes: 1 })).toBe(
      'PIN incorrecto. Te queda 1 intento.',
    );
  });

  it('bloqueado con los minutos que faltan', () => {
    expect(mensajeErrorLogin(423, { error: '…', minutosRestantes: 15 })).toBe(
      'Demasiados intentos. Intenta de nuevo en 15 min.',
    );
  });

  it('respuestas sin cuerpo esperado', () => {
    expect(mensajeErrorLogin(401, null)).toBe('PIN incorrecto.');
    expect(mensajeErrorLogin(423, null)).toBe('Demasiados intentos. Intenta de nuevo más tarde.');
    expect(mensajeErrorLogin(500, null)).toMatch(/No se pudo iniciar sesión/);
  });
});
