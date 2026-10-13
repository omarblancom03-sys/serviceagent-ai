import { describe, expect, it } from 'vitest';
import { separarEnlaces } from '../src/lib/enlaces';

describe('separarEnlaces', () => {
  it('texto sin URLs queda como un solo segmento', () => {
    expect(separarEnlaces('Hola, ¿qué vas a pedir?')).toEqual([
      { tipo: 'texto', valor: 'Hola, ¿qué vas a pedir?' },
    ]);
  });

  it('texto vacío no da segmentos', () => {
    expect(separarEnlaces('')).toEqual([]);
  });

  it('separa una URL https en medio del texto', () => {
    expect(separarEnlaces('Mira https://elgranero.mx/menu y elige')).toEqual([
      { tipo: 'texto', valor: 'Mira ' },
      { tipo: 'enlace', url: 'https://elgranero.mx/menu' },
      { tipo: 'texto', valor: ' y elige' },
    ]);
  });

  it('reconoce http y una URL al inicio', () => {
    expect(separarEnlaces('http://localhost:5173/menu es el menú')).toEqual([
      { tipo: 'enlace', url: 'http://localhost:5173/menu' },
      { tipo: 'texto', valor: ' es el menú' },
    ]);
  });

  it('no incluye la puntuación final en el enlace', () => {
    expect(separarEnlaces('Ve a https://x.mx/menu.')).toEqual([
      { tipo: 'texto', valor: 'Ve a ' },
      { tipo: 'enlace', url: 'https://x.mx/menu' },
      { tipo: 'texto', valor: '.' },
    ]);
    expect(separarEnlaces('(https://x.mx/menu), ¿sí?')).toEqual([
      { tipo: 'texto', valor: '(' },
      { tipo: 'enlace', url: 'https://x.mx/menu' },
      { tipo: 'texto', valor: '), ¿sí?' },
    ]);
  });

  it('separa varias URLs', () => {
    const segmentos = separarEnlaces('https://a.mx y https://b.mx!');
    expect(segmentos.filter((s) => s.tipo === 'enlace')).toEqual([
      { tipo: 'enlace', url: 'https://a.mx' },
      { tipo: 'enlace', url: 'https://b.mx' },
    ]);
    expect(segmentos.at(-1)).toEqual({ tipo: 'texto', valor: '!' });
  });

  it('javascript: nunca es enlace', () => {
    expect(separarEnlaces('javascript:alert(1)')).toEqual([
      { tipo: 'texto', valor: 'javascript:alert(1)' },
    ]);
    expect(
      separarEnlaces('clic en javascript://https://x.mx').every(
        (s) => s.tipo === 'texto' || s.url.startsWith('https://'),
      ),
    ).toBe(true);
  });

  it('un "https://" sin dominio queda como texto', () => {
    expect(separarEnlaces('escribe https://.')).toEqual([
      { tipo: 'texto', valor: 'escribe https://.' },
    ]);
  });
});
