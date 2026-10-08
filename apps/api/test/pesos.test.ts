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
  ])('%i centavos → "%s"', (centavos, texto) => {
    expect(formatearPesos(centavos)).toBe(texto);
  });
});
