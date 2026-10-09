import { describe, expect, it } from 'vitest';
import { formatearPesos } from '../src/lib/pesos';

describe('formatearPesos', () => {
  it.each([
    [0, '$0.00'],
    [2000, '$20.00'],
    [5500, '$55.00'],
    [40300, '$403.00'],
    [93600, '$936.00'],
    [123456, '$1,234.56'],
    [123456789, '$1,234,567.89'],
  ])('%i centavos → "%s"', (centavos, texto) => {
    expect(formatearPesos(centavos)).toBe(texto);
  });

  it.each([
    ['un decimal', 403.5],
    ['NaN', Number.NaN],
    ['un negativo', -100],
    ['un entero fuera del rango seguro', Number.MAX_SAFE_INTEGER + 1],
  ])('lanza un error con %s', (_caso, centavos) => {
    expect(() => formatearPesos(centavos)).toThrow('Monto inválido en centavos');
  });
});
