import { describe, expect, it } from 'vitest';
import {
  MINUTOS_ATRASO,
  clasesTicket,
  estaAtrasado,
  minutosDesde,
  textoTiempo,
} from '../src/lib/tiempoCocina';

const EN_COLA = '2026-10-15T18:00:00.000Z';
const minutosDespues = (minutos: number, segundos = 0) =>
  Date.parse(EN_COLA) + minutos * 60_000 + segundos * 1_000;

describe('minutosDesde', () => {
  it('cuenta los minutos completos desde que entró a la cola', () => {
    expect(minutosDesde(EN_COLA, minutosDespues(0))).toBe(0);
    expect(minutosDesde(EN_COLA, minutosDespues(1))).toBe(1);
    expect(minutosDesde(EN_COLA, minutosDespues(59))).toBe(59);
    expect(minutosDesde(EN_COLA, minutosDespues(60))).toBe(60);
    expect(minutosDesde(EN_COLA, minutosDespues(125))).toBe(125);
  });

  it('redondea hacia abajo', () => {
    expect(minutosDesde(EN_COLA, minutosDespues(0, 59))).toBe(0);
    expect(minutosDesde(EN_COLA, minutosDespues(1, 59))).toBe(1);
  });

  it('con una hora de entrada en el futuro (tablet atrasada) da 0', () => {
    expect(minutosDesde(EN_COLA, minutosDespues(-3))).toBe(0);
  });

  it('con una fecha inválida da 0', () => {
    expect(minutosDesde('no-es-fecha', minutosDespues(10))).toBe(0);
  });
});

describe('estaAtrasado', () => {
  it(`se marca desde ${MINUTOS_ATRASO} minutos exactos`, () => {
    expect(estaAtrasado(19)).toBe(false);
    expect(estaAtrasado(20)).toBe(true);
    expect(estaAtrasado(21)).toBe(true);
  });
});

describe('textoTiempo', () => {
  it('menos de una hora: solo minutos', () => {
    expect(textoTiempo(0)).toBe('0 min');
    expect(textoTiempo(12)).toBe('12 min');
    expect(textoTiempo(59)).toBe('59 min');
  });

  it('desde una hora: horas y minutos con dos dígitos', () => {
    expect(textoTiempo(60)).toBe('1 h 00 min');
    expect(textoTiempo(65)).toBe('1 h 05 min');
    expect(textoTiempo(150)).toBe('2 h 30 min');
  });
});

describe('clasesTicket', () => {
  const clases = (nuevo: boolean, atrasado: boolean) =>
    clasesTicket({ nuevo, atrasado }).split(' ');

  it('ninguno: borde naranja claro y sin anillo', () => {
    const c = clases(false, false);
    expect(c).toContain('border-orange-200');
    expect(c).not.toContain('ring-4');
    expect(c).not.toContain('border-red-500');
  });

  it('nuevo: anillo naranja', () => {
    const c = clases(true, false);
    expect(c).toContain('ring-4');
    expect(c).toContain('border-orange-400');
    expect(c).not.toContain('border-red-500');
  });

  it('atrasado: borde y fondo rojos, sin anillo', () => {
    const c = clases(false, true);
    expect(c).toContain('border-red-500');
    expect(c).toContain('bg-red-50');
    expect(c).not.toContain('ring-4');
    expect(c).not.toContain('border-orange-200');
  });

  it('nuevo y atrasado: manda el rojo y conserva el anillo', () => {
    const c = clases(true, true);
    expect(c).toContain('border-red-500');
    expect(c).toContain('ring-4');
    expect(c).not.toContain('border-orange-400');
  });

  it('terminado: verde, le gana al rojo y sin anillo', () => {
    const c = clasesTicket({ nuevo: true, atrasado: true, terminado: true }).split(' ');
    expect(c).toContain('border-green-500');
    expect(c).toContain('bg-green-50');
    expect(c).not.toContain('border-red-500');
    expect(c).not.toContain('ring-4');
  });
});
