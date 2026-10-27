import type { TicketCocina } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  botonDe,
  mensajeErrorAccion,
  proximoVencimiento,
  quitarCambio,
  quitarVencidos,
  registrarCambio,
  rutaAccion,
  segundosRestantes,
  ticketsParaMostrar,
  venceEnDe,
  type CambioLocal,
  type CambiosLocales,
} from '../src/lib/accionesCocina';
import { ErrorApi } from '../src/lib/api';

const ticket = (
  folio: number,
  estado: TicketCocina['estado'] = 'en_cola',
  minuto = folio - 1000,
): TicketCocina => ({
  folio,
  folioTexto: `#${folio}`,
  nombreCliente: 'María José',
  estado,
  enColaDesde: new Date(Date.UTC(2026, 9, 15, 18, minuto)).toISOString(),
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

const AHORA = 1_000_000;

const cambio = (folio: number, datos: Partial<CambioLocal> = {}): CambioLocal => ({
  folio,
  ticket: ticket(folio, 'preparando'),
  estado: 'listo',
  venceEn: AHORA + 10_000,
  deshacer: true,
  lista: 3,
  ...datos,
});

const sinCambios: CambiosLocales = new Map();
const con = (...cambios: CambioLocal[]): CambiosLocales =>
  cambios.reduce(registrarCambio, sinCambios);

describe('rutaAccion y botonDe', () => {
  it('arma la ruta de cada acción', () => {
    expect(rutaAccion(1001, 'empezar')).toBe('/cocina/pedidos/1001/empezar');
    expect(rutaAccion(1001, 'terminar')).toBe('/cocina/pedidos/1001/terminar');
    expect(rutaAccion(1001, 'deshacer')).toBe('/cocina/pedidos/1001/deshacer');
  });

  it('Empezar en cola, Terminado al preparar y nada ya terminado', () => {
    expect(botonDe('en_cola')).toBe('empezar');
    expect(botonDe('preparando')).toBe('terminar');
    expect(botonDe('listo')).toBeNull();
  });
});

describe('venceEnDe', () => {
  const respuesta = (cambiadoEn: string, deshacerHasta: string) => ({
    folio: 1001,
    folioTexto: '#1001',
    estado: 'listo' as const,
    cambiadoEn,
    deshacerHasta,
  });

  it('usa el plazo que da la API sobre el reloj de la tablet, aunque esté desfasado', () => {
    // La hora de Postgres va una hora adelante de la tablet: solo importa la diferencia.
    const r = respuesta('2026-10-15T19:00:00.000Z', '2026-10-15T19:00:10.000Z');
    expect(venceEnDe(r, AHORA)).toBe(AHORA + 10_000);
  });

  it('nunca da más de 10 s ni menos de 0', () => {
    expect(
      venceEnDe(respuesta('2026-10-15T19:00:00.000Z', '2026-10-15T19:01:00.000Z'), AHORA),
    ).toBe(AHORA + 10_000);
    expect(
      venceEnDe(respuesta('2026-10-15T19:00:10.000Z', '2026-10-15T19:00:00.000Z'), AHORA),
    ).toBe(AHORA);
  });

  it('con fechas que no se pueden leer, no ofrece Deshacer', () => {
    expect(venceEnDe(respuesta('x', 'y'), AHORA)).toBe(AHORA);
  });
});

describe('registrarCambio y quitarCambio', () => {
  it('no modifican el mapa original', () => {
    const uno = con(cambio(1001));
    const dos = registrarCambio(uno, cambio(1002));
    expect(uno.size).toBe(1);
    expect(dos.size).toBe(2);
    expect(quitarCambio(dos, 1001).has(1001)).toBe(false);
    expect(dos.has(1001)).toBe(true);
  });

  it('un cambio nuevo del mismo folio reemplaza al anterior (Terminado tras Empezar)', () => {
    const cambios = con(cambio(1001, { estado: 'preparando' }), cambio(1001, { estado: 'listo' }));
    expect(cambios.get(1001)?.estado).toBe('listo');
  });

  it('quitar un folio que no está devuelve el mismo mapa', () => {
    const cambios = con(cambio(1001));
    expect(quitarCambio(cambios, 9999)).toBe(cambios);
  });
});

describe('quitarVencidos', () => {
  it('se queda mientras no vence', () => {
    const cambios = con(cambio(1001));
    expect(quitarVencidos(cambios, AHORA + 9_999, 10)).toBe(cambios);
  });

  it('vencido y con una lista pedida después, se quita', () => {
    expect(quitarVencidos(con(cambio(1001)), AHORA + 10_000, 4).size).toBe(0);
  });

  it('vencido pero sin una lista posterior, se queda hasta que llegue', () => {
    expect(quitarVencidos(con(cambio(1001)), AHORA + 10_000, 3).size).toBe(1);
  });
});

describe('proximoVencimiento', () => {
  it('el más cercano en el futuro, o null', () => {
    const cambios = con(
      cambio(1001, { venceEn: AHORA + 8_000 }),
      cambio(1002, { venceEn: AHORA + 3_000 }),
    );
    expect(proximoVencimiento(cambios, AHORA)).toBe(AHORA + 3_000);
    expect(proximoVencimiento(cambios, AHORA + 3_000)).toBe(AHORA + 8_000);
    expect(proximoVencimiento(cambios, AHORA + 8_000)).toBeNull();
    expect(proximoVencimiento(sinCambios, AHORA)).toBeNull();
  });
});

describe('ticketsParaMostrar', () => {
  const folios = (vistas: ReturnType<typeof ticketsParaMostrar>) =>
    vistas.map((v) => `${v.ticket.folio}:${v.estado}`);

  it('sin cambios locales muestra la lista tal cual', () => {
    const lista = [ticket(1001), ticket(1002, 'preparando')];
    expect(folios(ticketsParaMostrar(lista, sinCambios, AHORA, 3))).toEqual([
      '1001:en_cola',
      '1002:preparando',
    ]);
  });

  it('lo terminado aquí sigue en su lugar, en verde, aunque ya no venga en la lista', () => {
    const lista = [ticket(1001), ticket(1003)];
    const vistas = ticketsParaMostrar(lista, con(cambio(1002)), AHORA + 2_000, 4);
    expect(folios(vistas)).toEqual(['1001:en_cola', '1002:listo', '1003:en_cola']);
    expect(vistas[1]?.deshacerHasta).toBe(AHORA + 10_000);
  });

  it('una lista vieja (pedida antes del cambio) no le gana al cambio local', () => {
    const lista = [ticket(1001, 'en_cola')];
    const empezado = cambio(1001, { estado: 'preparando', ticket: ticket(1001) });
    expect(folios(ticketsParaMostrar(lista, con(empezado), AHORA + 1_000, 3))).toEqual([
      '1001:preparando',
    ]);
  });

  it('al vencer sale el terminado y ya no hay Deshacer', () => {
    const vistas = ticketsParaMostrar([ticket(1001)], con(cambio(1002)), AHORA + 10_000, 4);
    expect(folios(vistas)).toEqual(['1001:en_cola']);
  });

  it('vencido pero sin lista nueva, se queda sin botón Deshacer', () => {
    const vistas = ticketsParaMostrar([], con(cambio(1002)), AHORA + 10_000, 3);
    expect(folios(vistas)).toEqual(['1002:listo']);
    expect(vistas[0]?.deshacerHasta).toBeNull();
  });

  it('lo que regresó por Deshacer se muestra en su estado hasta que llega una lista nueva', () => {
    // Deshacer de Terminado: la última lista (vieja) ya no lo trae.
    const regreso = cambio(1002, { estado: 'preparando', venceEn: AHORA, deshacer: false });
    const vistas = ticketsParaMostrar([ticket(1001)], con(regreso), AHORA + 500, 3);
    expect(folios(vistas)).toEqual(['1001:en_cola', '1002:preparando']);
    expect(vistas[1]?.deshacerHasta).toBeNull();
    // Llega la lista pedida después: manda la API.
    const nueva = [ticket(1001), ticket(1002, 'preparando')];
    expect(folios(ticketsParaMostrar(nueva, con(regreso), AHORA + 800, 4))).toEqual([
      '1001:en_cola',
      '1002:preparando',
    ]);
  });

  it('sin Deshacer cuando el cambio ya no lo ofrece (Deshacer falló)', () => {
    const fallido = cambio(1002, { deshacer: false });
    expect(ticketsParaMostrar([], con(fallido), AHORA, 3)[0]?.deshacerHasta).toBeNull();
  });
});

describe('segundosRestantes', () => {
  it('redondea hacia arriba y nunca baja de 0', () => {
    expect(segundosRestantes(AHORA + 10_000, AHORA)).toBe(10);
    expect(segundosRestantes(AHORA + 10_000, AHORA + 100)).toBe(10);
    expect(segundosRestantes(AHORA + 10_000, AHORA + 9_001)).toBe(1);
    expect(segundosRestantes(AHORA + 10_000, AHORA + 10_000)).toBe(0);
    expect(segundosRestantes(AHORA, AHORA + 5_000)).toBe(0);
  });
});

describe('mensajeErrorAccion', () => {
  it('409: el texto de la API, que ya viene en español', () => {
    const cuerpo = {
      error: 'El pedido #1001 ya no está en ese estado. Actualiza la lista.',
      codigo: 'estado_cambio',
      estadoActual: 'listo',
    };
    expect(mensajeErrorAccion(new ErrorApi(409, cuerpo))).toBe(cuerpo.error);
  });

  it('409 con plazo vencido', () => {
    const cuerpo = {
      error: 'Ya pasó el tiempo para deshacer el pedido #1001.',
      codigo: 'plazo_vencido',
      estadoActual: 'listo',
    };
    expect(mensajeErrorAccion(new ErrorApi(409, cuerpo))).toBe(cuerpo.error);
  });

  it('409 con otra forma: texto genérico, sin códigos', () => {
    expect(mensajeErrorAccion(new ErrorApi(409, { otro: 1 }))).toBe(
      'El pedido ya no está en ese estado. Actualiza la lista.',
    );
  });

  it('404, 403 y cualquier otra falla', () => {
    expect(mensajeErrorAccion(new ErrorApi(404, null))).toMatch(/No encontramos/);
    expect(mensajeErrorAccion(new ErrorApi(403, null))).toMatch(/no puede cambiar/);
    const generico = 'No se pudo guardar el cambio. Revisa la conexión e intenta de nuevo.';
    expect(mensajeErrorAccion(new ErrorApi(500, null))).toBe(generico);
    expect(mensajeErrorAccion(new TypeError('Failed to fetch'))).toBe(generico);
  });
});
