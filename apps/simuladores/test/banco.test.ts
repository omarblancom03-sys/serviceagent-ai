import {
  TransferenciaBancoPeticionSchema,
  type TransferenciaBanco,
  type TransferenciaBancoPeticion,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/api';
import {
  agregarAlHistorial,
  aplicarErrorSimulado,
  formatearClabe,
  formatearFecha,
  leerFormulario,
  leerHistorial,
  LLAVE_HISTORIAL,
  MAX_HISTORIAL,
  mensajeDeError,
  MENSAJE_ERROR_BANCO,
  MENSAJE_SIN_CONEXION,
  pesosACentavos,
  type Almacen,
  type TransferenciaEnviada,
} from '../src/lib/banco';

/* US-24 (D70): lógica de la pantalla `/banco`. */

const CLABE = '646180157000000004';
const PETICION: TransferenciaBancoPeticion = {
  clabeDestino: CLABE,
  montoCentavos: 18800,
  referencia: 'GRN-1001-K7',
};

let consecutivo = 0;
function transferencia(cambios: Partial<TransferenciaBanco> = {}): TransferenciaBanco {
  consecutivo += 1;
  return {
    idTransferencia: `0b9f6a52-3c1d-4e8a-9f60-${String(consecutivo).padStart(12, '0')}`,
    ...PETICION,
    fecha: '2026-11-13T18:05:00.000Z',
    montoTexto: '$188.00',
    avisoEntregado: true,
    ...cambios,
  };
}
const enviada = (cambios: Partial<TransferenciaBanco> = {}): TransferenciaEnviada => ({
  transferencia: transferencia(cambios),
  errorSimulado: null,
});

function almacenEnMemoria(inicial?: string): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  if (inicial !== undefined) datos.set(LLAVE_HISTORIAL, inicial);
  return {
    datos,
    getItem: (llave) => datos.get(llave) ?? null,
    setItem: (llave, valor) => void datos.set(llave, valor),
  };
}

describe('pesosACentavos', () => {
  it.each([
    ['188', 18800],
    ['188.5', 18850],
    ['188.50', 18850],
    ['188.05', 18805],
    ['0.01', 1],
    ['$188.00', 18800],
    [' 1,234.50 ', 123450],
    ['100000', 10_000_000],
    // El clásico de punto flotante: 1.15 * 100 = 114.99999999999999.
    ['1.15', 115],
    ['0', 0],
  ])('"%s" → %i centavos', (texto, centavos) => {
    expect(pesosACentavos(texto)).toBe(centavos);
  });

  it.each(['', 'abc', '188.505', '-5', '1e3', '18.8.0', '.50', '188.', '12 pesos'])(
    '"%s" no es un monto',
    (texto) => {
      expect(pesosACentavos(texto)).toBeNull();
    },
  );
});

describe('leerFormulario', () => {
  const campos = { clabe: CLABE, monto: '188.00', referencia: 'GRN-1001-K7' };

  it('con los tres campos bien arma la petición del contrato, en centavos', () => {
    const formulario = leerFormulario(campos);
    expect(formulario).toEqual({ ok: true, peticion: PETICION });
    if (formulario.ok) {
      expect(TransferenciaBancoPeticionSchema.safeParse(formulario.peticion).success).toBe(true);
    }
  });

  it('acepta la CLABE con espacios y la referencia con espacios alrededor', () => {
    expect(
      leerFormulario({
        clabe: '646 180 15700000000 4',
        monto: '188',
        referencia: '  GRN-1001-K7 ',
      }),
    ).toEqual({ ok: true, peticion: PETICION });
  });

  it('dice qué corregir en cada campo, todos a la vez', () => {
    expect(leerFormulario({ clabe: '123', monto: 'mucho', referencia: 'con espacios' })).toEqual({
      ok: false,
      errores: {
        clabe: 'La CLABE son 18 dígitos.',
        monto: 'Escribe el monto en pesos, por ejemplo 188.00.',
        referencia: 'Solo letras, números y guiones (máximo 40).',
      },
    });
  });

  it.each([
    ['0', 'El monto debe ser mayor a cero.'],
    ['0.00', 'El monto debe ser mayor a cero.'],
    ['100000.01', 'El monto máximo por transferencia es $100,000.00.'],
  ])('monto "%s" → "%s"', (monto, mensaje) => {
    expect(leerFormulario({ ...campos, monto })).toEqual({
      ok: false,
      errores: { monto: mensaje },
    });
  });

  it.each(['', '   ', 'A'.repeat(41), 'ñandú', 'GRN_1001'])(
    'referencia "%s" no vale',
    (referencia) => {
      const formulario = leerFormulario({ ...campos, referencia });
      expect(formulario.ok).toBe(false);
    },
  );
});

describe('aplicarErrorSimulado', () => {
  it('sin error manda la petición tal cual', () => {
    expect(aplicarErrorSimulado(PETICION, null)).toEqual(PETICION);
  });

  it('monto distinto: un peso menos, y lo demás igual', () => {
    expect(aplicarErrorSimulado(PETICION, 'monto_distinto')).toEqual({
      ...PETICION,
      montoCentavos: 18700,
    });
  });

  it.each([1, 50, 100])(
    'monto distinto con %i centavos: un peso más, nunca cero',
    (montoCentavos) => {
      const cambiada = aplicarErrorSimulado({ ...PETICION, montoCentavos }, 'monto_distinto');
      expect(cambiada.montoCentavos).toBe(montoCentavos + 100);
    },
  );

  it.each([
    ['GRN-1001-K7', 'GRN-1001-KX'],
    ['GRN-1001-KX', 'GRN-1001-KY'],
    ['A', 'X'],
    ['X', 'Y'],
    ['A'.repeat(40), `${'A'.repeat(39)}X`],
  ])('referencia equivocada: "%s" → "%s"', (referencia, esperada) => {
    const cambiada = aplicarErrorSimulado({ ...PETICION, referencia }, 'referencia_equivocada');
    expect(cambiada).toEqual({ ...PETICION, referencia: esperada });
  });

  it('lo que sale siempre cumple el contrato y es distinto de lo que entró', () => {
    for (const error of ['monto_distinto', 'referencia_equivocada'] as const) {
      const cambiada = aplicarErrorSimulado(PETICION, error);
      expect(TransferenciaBancoPeticionSchema.safeParse(cambiada).success).toBe(true);
      expect(cambiada).not.toEqual(PETICION);
    }
  });
});

describe('historial', () => {
  it('sin nada guardado está vacío', () => {
    expect(leerHistorial(almacenEnMemoria())).toEqual([]);
  });

  it('la nueva va primero y se guarda para la siguiente visita', () => {
    const almacen = almacenEnMemoria();
    const primera = enviada({ referencia: 'PRIMERA' });
    const segunda: TransferenciaEnviada = {
      transferencia: transferencia({ referencia: 'SEGUNDX', avisoEntregado: false }),
      errorSimulado: 'referencia_equivocada',
    };

    let historial = agregarAlHistorial(almacen, [], primera);
    historial = agregarAlHistorial(almacen, historial, segunda);

    expect(historial).toEqual([segunda, primera]);
    expect(leerHistorial(almacen)).toEqual([segunda, primera]);
  });

  it(`guarda como máximo ${MAX_HISTORIAL}: salen las más antiguas`, () => {
    const almacen = almacenEnMemoria();
    let historial: TransferenciaEnviada[] = [];
    for (let i = 0; i <= MAX_HISTORIAL; i++) {
      historial = agregarAlHistorial(almacen, historial, enviada({ referencia: `REF-${i}` }));
    }
    expect(historial).toHaveLength(MAX_HISTORIAL);
    expect(historial[0]?.transferencia.referencia).toBe(`REF-${MAX_HISTORIAL}`);
    expect(historial.at(-1)?.transferencia.referencia).toBe('REF-1');
    expect(leerHistorial(almacen)).toEqual(historial);
  });

  it.each(['{mal', '"texto"', '{"a":1}', 'null', '42'])(
    'lo guardado dañado (%s) se ignora',
    (guardado) => {
      expect(leerHistorial(almacenEnMemoria(guardado))).toEqual([]);
    },
  );

  it('descarta las entradas que no cumplen el contrato y conserva las buenas', () => {
    const buena = enviada();
    const guardado = JSON.stringify([
      { transferencia: { ...buena.transferencia, montoCentavos: 'mucho' }, errorSimulado: null },
      null,
      'texto',
      buena,
      { transferencia: transferencia({ referencia: 'OTRA' }), errorSimulado: 'inventado' },
    ]);

    const historial = leerHistorial(almacenEnMemoria(guardado));

    expect(historial).toHaveLength(2);
    expect(historial[0]).toEqual(buena);
    // Un error simulado desconocido se lee como "sin error", no tumba la entrada.
    expect(historial[1]).toMatchObject({
      errorSimulado: null,
      transferencia: { referencia: 'OTRA' },
    });
  });

  it('si el navegador no deja guardar, el historial sigue en pantalla', () => {
    const almacen: Almacen = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const nueva = enviada();
    expect(agregarAlHistorial(almacen, [], nueva)).toEqual([nueva]);
  });

  it('si leer el almacenamiento lanza un error, el historial está vacío', () => {
    const almacen: Almacen = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    };
    expect(leerHistorial(almacen)).toEqual([]);
  });
});

describe('textos', () => {
  it('la fecha sale en la hora del restaurante (America/Chihuahua)', () => {
    // 18:05 UTC son las 12:05 en Chihuahua (UTC-6, sin horario de verano).
    const texto = formatearFecha('2026-11-13T18:05:00.000Z');
    expect(texto).toContain('13 nov 2026');
    expect(texto).toMatch(/12:05/);
  });

  it('una fecha ilegible sale vacía', () => {
    expect(formatearFecha('ayer')).toBe('');
  });

  it('la CLABE se muestra en grupos', () => {
    expect(formatearClabe(CLABE)).toBe('646 180 15700000000 4');
    expect(formatearClabe('123')).toBe('123');
  });

  it('el error del banco se muestra con su texto', () => {
    expect(mensajeDeError(new ErrorApi(400, { error: 'Revisa los datos.' }))).toBe(
      'Revisa los datos.',
    );
  });

  it.each([null, 'texto', {}, { error: '' }, { error: 42 }])(
    'un error del banco sin texto legible (%j) sale con el mensaje general',
    (cuerpo) => {
      expect(mensajeDeError(new ErrorApi(503, cuerpo))).toBe(MENSAJE_ERROR_BANCO);
    },
  );

  it('sin conexión y cualquier otra falla tienen su mensaje, sin detalles técnicos', () => {
    expect(mensajeDeError(new TypeError('Failed to fetch'))).toBe(MENSAJE_SIN_CONEXION);
    expect(mensajeDeError(new Error('ZodError: ...'))).toBe(MENSAJE_ERROR_BANCO);
  });
});
