import type { TicketCocina } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/api';
import {
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
