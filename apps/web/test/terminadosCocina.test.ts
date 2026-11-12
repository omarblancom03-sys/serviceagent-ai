import {
  MAX_TERMINADOS_COCINA,
  type TicketCocina,
  type TicketTerminadoCocina,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  PLAZO_TERMINADO_MS,
  comoTerminado,
  comoTicket,
  proximoVencimientoTerminado,
  terminadosVigentes,
  textoHace,
  venceTerminadoEn,
} from '../src/lib/terminadosCocina';

const BASE = Date.UTC(2026, 10, 11, 18, 0);
const minuto = (m: number, s = 0) => BASE + m * 60_000 + s * 1_000;
const iso = (ms: number) => new Date(ms).toISOString();

const terminado = (folio: number, terminadoMinuto: number): TicketTerminadoCocina => ({
  folio,
  folioTexto: `#${folio}`,
  nombreCliente: 'Ana',
  enColaDesde: iso(minuto(-30)),
  terminadoEn: iso(minuto(terminadoMinuto)),
  renglones: [
    {
      tipo: 'platillo',
      cantidad: 1,
      nombre: 'Fajitas',
      variante: null,
      sinIngredientes: [],
      extras: [],
    },
  ],
});

const folios = (lista: readonly TicketTerminadoCocina[]) => lista.map((t) => t.folio);

describe('terminadosVigentes', () => {
  it('a los 14:59 se ve; a los 15:00 exactos ya salió (reloj de la tablet)', () => {
    const lista = [terminado(1001, 0)];
    expect(folios(terminadosVigentes(lista, minuto(14, 59)))).toEqual([1001]);
    expect(folios(terminadosVigentes(lista, minuto(15)))).toEqual([]);
    expect(venceTerminadoEn(lista[0]!)).toBe(minuto(0) + PLAZO_TERMINADO_MS);
  });

  it('del más reciente al más viejo', () => {
    const lista = [terminado(1001, 1), terminado(1003, 5), terminado(1002, 3)];
    expect(folios(terminadosVigentes(lista, minuto(6)))).toEqual([1003, 1002, 1001]);
  });

  it('un folio repetido (local y de la API) sale una vez, con su Terminado más reciente', () => {
    const lista = [terminado(1001, 2), terminado(1001, 4), terminado(1002, 3)];
    const vigentes = terminadosVigentes(lista, minuto(5));
    expect(folios(vigentes)).toEqual([1001, 1002]);
    expect(vigentes[0]?.terminadoEn).toBe(iso(minuto(4)));
  });

  it(`como máximo ${MAX_TERMINADOS_COCINA}, los más recientes`, () => {
    const lista = Array.from({ length: MAX_TERMINADOS_COCINA + 3 }, (_, i) =>
      terminado(1001 + i, i * 0.5),
    );
    const vigentes = terminadosVigentes(lista, minuto(12));
    expect(vigentes).toHaveLength(MAX_TERMINADOS_COCINA);
    expect(vigentes[0]?.folio).toBe(1001 + MAX_TERMINADOS_COCINA + 2);
    expect(folios(vigentes)).not.toContain(1001);
  });

  it('una fecha que no se puede leer no se muestra', () => {
    expect(terminadosVigentes([{ ...terminado(1001, 0), terminadoEn: 'x' }], minuto(1))).toEqual(
      [],
    );
  });
});

describe('proximoVencimientoTerminado', () => {
  it('el más cercano en el futuro, o null', () => {
    const lista = [terminado(1001, 2), terminado(1002, 1)];
    expect(proximoVencimientoTerminado(lista, minuto(3))).toBe(minuto(16));
    expect(proximoVencimientoTerminado(lista, minuto(16))).toBe(minuto(17));
    expect(proximoVencimientoTerminado(lista, minuto(17))).toBeNull();
    expect(proximoVencimientoTerminado([], minuto(0))).toBeNull();
  });
});

describe('textoHace', () => {
  it('menos de un minuto, minutos completos y reloj atrasado', () => {
    const en = iso(minuto(0));
    expect(textoHace(en, minuto(0, 59))).toBe('hace menos de 1 min');
    expect(textoHace(en, minuto(1))).toBe('hace 1 min');
    expect(textoHace(en, minuto(14, 30))).toBe('hace 14 min');
    expect(textoHace(en, minuto(-2))).toBe('hace menos de 1 min');
  });
});

describe('comoTerminado y comoTicket', () => {
  it('convierten sin perder datos ni dejar campos de más', () => {
    const t = terminado(1001, 3);
    const ticket = comoTicket(t, 'preparando');
    expect(ticket).toEqual<TicketCocina>({
      folio: 1001,
      folioTexto: '#1001',
      nombreCliente: 'Ana',
      estado: 'preparando',
      enColaDesde: t.enColaDesde,
      renglones: t.renglones,
    });
    expect(comoTerminado(ticket, t.terminadoEn)).toEqual(t);
  });
});
