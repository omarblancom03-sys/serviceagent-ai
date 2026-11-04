import type { AlertaAtencion } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  DURACION_AVISO_MS,
  PLAZO_DESHACER_MS,
  alertasVisibles,
  crearCandadoAtender,
  datosClienteAlerta,
  deshacerAtendida,
  empezarEnvio,
  enlaceTelefono,
  estadoAtenderInicial,
  hayMasAlertas,
  marcarAtendida,
  mensajeErrorAlertas,
  proximoVencimiento,
  quitarAvisosVencidos,
  resultadoAtender,
  terminarEnvio,
  textoConteoAlertas,
  textoEspera,
  textoTelefono,
  vencidas,
} from '../src/lib/alertasCaja';
import { ErrorApi } from '../src/lib/api';

const alerta = (idAlerta: number, extra: Partial<AlertaAtencion> = {}): AlertaAtencion => ({
  idAlerta,
  telefono: '6145550101',
  nombre: 'Ana Prueba',
  folio: 1024,
  folioTexto: '#1024',
  motivo: 'Quiere factura.',
  creadaEn: '2026-11-03T18:00:00.000Z',
  ...extra,
});

const T0 = Date.parse('2026-11-03T18:00:00.000Z');
const MIN = 60_000;

describe('textos de la tarjeta de alerta (US-18)', () => {
  it('textoEspera: menos de 1 min, minutos y horas', () => {
    const creada = '2026-11-03T18:00:00.000Z';
    expect(textoEspera(creada, T0 + 30_000)).toBe('Esperando menos de 1 min');
    expect(textoEspera(creada, T0 + 12 * MIN)).toBe('Esperando 12 min');
    expect(textoEspera(creada, T0 + 65 * MIN)).toBe('Esperando 1 h 05 min');
  });

  it('textoEspera: con el reloj de la caja atrasado o una fecha mala no sale negativo', () => {
    expect(textoEspera('2026-11-03T18:00:00.000Z', T0 - 5 * MIN)).toBe('Esperando menos de 1 min');
    expect(textoEspera('no-es-fecha', T0)).toBe('Esperando menos de 1 min');
  });

  it('textoEspera: sin rojo ni "Atrasado" aunque pase mucho tiempo', () => {
    expect(textoEspera('2026-11-03T18:00:00.000Z', T0 + 300 * MIN)).not.toMatch(/atrasad/i);
  });

  it('datosClienteAlerta: con y sin nombre, con y sin folio', () => {
    expect(datosClienteAlerta(alerta(1))).toEqual({ nombre: 'Ana Prueba', folio: 'Folio #1024' });
    expect(datosClienteAlerta(alerta(1, { nombre: null, folio: null, folioTexto: null }))).toEqual({
      nombre: 'Sin nombre',
      folio: 'Sin folio',
    });
    expect(datosClienteAlerta(alerta(1, { nombre: '   ' })).nombre).toBe('Sin nombre');
  });

  it('teléfono para leer y para llamar', () => {
    expect(textoTelefono('6145550101')).toBe('614 555 0101');
    expect(enlaceTelefono('6145550101')).toBe('tel:6145550101');
    expect(textoTelefono('123')).toBe('123');
  });

  it('conteo: "(N)" y "(N+)" cuando la API cortó en 100', () => {
    expect(textoConteoAlertas(0, 0)).toBe('(0)');
    expect(textoConteoAlertas(1, 1)).toBe('(1)');
    expect(textoConteoAlertas(99, 99)).toBe('(99)');
    expect(textoConteoAlertas(100, 100)).toBe('(100+)');
    // Una en su plazo de Deshacer no se cuenta, pero sigue avisando que puede haber más.
    expect(textoConteoAlertas(99, 100)).toBe('(99+)');
    expect(hayMasAlertas(99)).toBe(false);
    expect(hayMasAlertas(100)).toBe(true);
  });

  it('mensajeErrorAlertas: 403, primera carga y recarga, sin códigos técnicos', () => {
    expect(mensajeErrorAlertas(new ErrorApi(403, null), true)).toBe(
      'Tu usuario no tiene acceso a caja.',
    );
    const primera = mensajeErrorAlertas(new TypeError('Failed to fetch'), true);
    expect(primera).toMatch(/no se pudieron cargar las alertas/i);
    expect(primera).not.toMatch(/ningún cliente/i);
    expect(mensajeErrorAlertas(new ErrorApi(500, null), false)).toMatch(/no se pudo actualizar/i);
    expect(primera).not.toMatch(/\d{3}|fetch/i);
  });
});

describe('resultadoAtender: qué hacer con cada respuesta (US-18)', () => {
  it('200 la quita sin aviso; 409 y 404 la quitan con aviso informativo', () => {
    expect(resultadoAtender(null)).toEqual({ tipo: 'quitar', aviso: null });
    expect(resultadoAtender(new ErrorApi(409, { error: 'Otro empleado ya atendió.' }))).toEqual({
      tipo: 'quitar',
      aviso: 'Esta alerta ya estaba atendida.',
    });
    expect(resultadoAtender(new ErrorApi(404, null))).toEqual({
      tipo: 'quitar',
      aviso: 'Esa alerta ya no existe.',
    });
  });

  it('403, 400, 500, red y respuesta rara la regresan con error en la tarjeta', () => {
    expect(resultadoAtender(new ErrorApi(403, null))).toEqual({
      tipo: 'regresar',
      error: 'Tu usuario no tiene acceso a caja.',
    });
    const zod = Object.assign(new Error('contrato'), { name: 'ZodError' });
    for (const error of [
      new ErrorApi(400, null),
      new ErrorApi(500, null),
      new TypeError('Failed to fetch'),
      zod,
    ]) {
      expect(resultadoAtender(error)).toEqual({
        tipo: 'regresar',
        error: 'No se pudo marcar la alerta. Intenta de nuevo.',
      });
    }
  });

  it('ningún texto trae códigos técnicos ni el texto de la API', () => {
    const textos = [409, 404, 403, 400, 500].map((s) => {
      const r = resultadoAtender(new ErrorApi(s, { error: 'texto de la API' }));
      return r.tipo === 'quitar' ? r.aviso : r.error;
    });
    for (const texto of textos) {
      expect(texto).not.toMatch(/\d{3}|API|texto de la API/);
    }
  });
});

describe('botón Atendida con Deshacer (US-18)', () => {
  it('al tocar, la alerta se oculta y empieza su plazo de 5 s', () => {
    const estado = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    expect(PLAZO_DESHACER_MS).toBe(5_000);
    expect(estado.enPlazo.get(1)?.venceEn).toBe(T0 + 5_000);
    expect(alertasVisibles([alerta(1), alerta(2)], estado).map((a) => a.idAlerta)).toEqual([2]);
  });

  it('Deshacer dentro del plazo: vuelve y no se manda nada', () => {
    let estado = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    estado = deshacerAtendida(estado, 1);
    expect(alertasVisibles([alerta(1)], estado)).toHaveLength(1);
    expect(vencidas(estado, T0 + 10_000)).toEqual([]);
    expect(proximoVencimiento(estado)).toBeNull();
  });

  it('antes de terminar el plazo no hay nada que mandar; al terminar, sí', () => {
    const estado = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    expect(vencidas(estado, T0 + 4_999)).toEqual([]);
    expect(vencidas(estado, T0 + 5_000)).toEqual([1]);
    expect(proximoVencimiento(estado)).toBe(T0 + 5_000);
  });

  it('un doble clic no reinicia el plazo', () => {
    const una = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    const dos = marcarAtendida(una, alerta(1), T0 + 300);
    expect(dos).toBe(una);
  });

  it('varias alertas en su plazo a la vez, cada una con su propio Deshacer', () => {
    let estado = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    estado = marcarAtendida(estado, alerta(2), T0 + 2_000);
    estado = deshacerAtendida(estado, 1);
    expect([...estado.enPlazo.keys()]).toEqual([2]);
    expect(vencidas(estado, T0 + 7_000)).toEqual([2]);
    expect(alertasVisibles([alerta(1), alerta(2)], estado).map((a) => a.idAlerta)).toEqual([1]);
  });

  it('una recarga de la lista no revive una alerta en plazo, mandándose ni ya atendida', () => {
    let estado = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    estado = marcarAtendida(estado, alerta(2), T0);
    estado = marcarAtendida(estado, alerta(3), T0 + 1_000);
    estado = empezarEnvio(estado, vencidas(estado, T0 + 5_000));
    estado = terminarEnvio(estado, 1, resultadoAtender(null), T0 + 5_500);
    // 1 ya atendida, 2 mandándose, 3 en plazo: la lista vieja de la API trae las tres.
    const lista = [alerta(1), alerta(2), alerta(3), alerta(4)];
    expect(alertasVisibles(lista, estado).map((a) => a.idAlerta)).toEqual([4]);
  });

  it('al terminar el plazo pasa a "mandándose" y ya no se puede deshacer', () => {
    let estado = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    estado = empezarEnvio(estado, [1]);
    expect(estado.enPlazo.size).toBe(0);
    expect(estado.enviando.get(1)?.telefono).toBe('6145550101');
    expect(deshacerAtendida(estado, 1)).toBe(estado);
    // Una alerta que ya se había deshecho no se manda aunque venga en la lista de vencidas.
    expect(empezarEnvio(estadoAtenderInicial(), [1]).enviando.size).toBe(0);
  });

  it('200: queda quitada sin aviso', () => {
    let estado = empezarEnvio(marcarAtendida(estadoAtenderInicial(), alerta(1), T0), [1]);
    estado = terminarEnvio(estado, 1, resultadoAtender(null), T0 + 5_200);
    expect(estado.enviando.size).toBe(0);
    expect(estado.quitadas.has(1)).toBe(true);
    expect(estado.avisos.size).toBe(0);
    // Ya quitada, otro clic (de una lista vieja) no hace nada.
    expect(marcarAtendida(estado, alerta(1), T0 + 6_000)).toBe(estado);
  });

  it('409: quitada con aviso informativo que se borra solo a los 6 s', () => {
    let estado = empezarEnvio(marcarAtendida(estadoAtenderInicial(), alerta(1), T0), [1]);
    estado = terminarEnvio(estado, 1, resultadoAtender(new ErrorApi(409, null)), T0 + 5_000);
    expect(estado.quitadas.has(1)).toBe(true);
    expect(estado.avisos.get(1)?.texto).toBe('Esta alerta ya estaba atendida.');
    expect(proximoVencimiento(estado)).toBe(T0 + 5_000 + DURACION_AVISO_MS);
    expect(quitarAvisosVencidos(estado, T0 + 10_000)).toBe(estado);
    expect(quitarAvisosVencidos(estado, T0 + 11_000).avisos.size).toBe(0);
  });

  it('red o 500: regresa con el error; al volver a tocar, se limpia y empieza otro plazo', () => {
    let estado = empezarEnvio(marcarAtendida(estadoAtenderInicial(), alerta(1), T0), [1]);
    estado = terminarEnvio(estado, 1, resultadoAtender(new TypeError('Failed')), T0 + 5_100);
    expect(alertasVisibles([alerta(1)], estado)).toHaveLength(1);
    expect(estado.errores.get(1)).toBe('No se pudo marcar la alerta. Intenta de nuevo.');

    estado = marcarAtendida(estado, alerta(1), T0 + 8_000);
    expect(estado.errores.has(1)).toBe(false);
    expect(estado.enPlazo.get(1)?.venceEn).toBe(T0 + 13_000);
  });

  it('cerrar la pestaña o cambiar de pantalla dentro del plazo no manda nada', () => {
    // El estado vive en memoria del componente: al desmontarse se pierde con todo y temporizador.
    // Lo que queda por probar aquí es que, mientras no termine el plazo, nada está mandándose.
    const estado = marcarAtendida(estadoAtenderInicial(), alerta(1), T0);
    expect(estado.enviando.size).toBe(0);
    expect(vencidas(estado, T0 + 4_999)).toEqual([]);
  });
});

describe('crearCandadoAtender (US-18)', () => {
  it('el segundo intento con el mismo id se rechaza; otro id pasa; al soltar, se puede otra vez', () => {
    const candado = crearCandadoAtender();
    expect(candado.tomar(1)).toBe(true);
    expect(candado.tomar(1)).toBe(false);
    expect(candado.tomar(2)).toBe(true);
    candado.soltar(1);
    expect(candado.tomar(1)).toBe(true);
  });
});
