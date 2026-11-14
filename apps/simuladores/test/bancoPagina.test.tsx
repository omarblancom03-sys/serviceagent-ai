import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Banco } from '../src/pages/Banco';

/*
 * US-24: la página `/banco` se pinta completa sin navegador (sin `window` ni `localStorage`, como
 * cuando el almacenamiento está bloqueado). La lógica se prueba en `banco.test.ts`.
 */

describe('página /banco', () => {
  const html = renderToStaticMarkup(<Banco />);

  it('tiene los tres campos de la transferencia con su etiqueta y el botón Transferir', () => {
    for (const [id, etiqueta] of [
      ['clabe', 'CLABE destino'],
      ['monto', 'Monto (MXN)'],
      ['referencia', 'Referencia'],
    ]) {
      expect(html).toContain(`<label for="${id}"`);
      expect(html).toContain(etiqueta);
      expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"`));
    }
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Transferir<\/button>/);
  });

  it('ofrece los dos errores a propósito y por defecto no simula ninguno', () => {
    expect(html).toContain('Monto distinto');
    expect(html).toContain('Referencia equivocada');
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(3);
    expect(radios.filter((radio) => radio.includes('checked'))).toHaveLength(1);
    expect(radios[0]).toContain('checked');
  });

  it('sin transferencias, el historial lo dice', () => {
    expect(html).toContain('Transferencias enviadas');
    expect(html).toContain('Todavía no has hecho transferencias.');
    expect(html).not.toContain('<table');
  });

  it('avisa que es una práctica y no mueve dinero real', () => {
    expect(html).toContain('Aquí no se mueve dinero real.');
  });
});
