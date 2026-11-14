import { createHmac } from 'node:crypto';
import {
  AvisoTransferenciaSchema,
  ErrorBancoSchema,
  RespuestaWebhookBancoSchema,
  TransferenciaBancoPeticionSchema,
  TransferenciaBancoSchema,
} from '@serviceagent/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import { firmarAvisoBanco, verificarFirmaBanco } from '../src/lib/firmaBanco';
import { transferir } from '../src/services/bancoSimulado';

/*
 * US-24 (D70): el banco simulado hace la transferencia y le avisa al restaurante con el webhook
 * firmado. La conciliación con el pedido es de US-25.
 */

const SECRETO = 'secreto-de-prueba-del-banco';
const env = { BANCO_WEBHOOK_SECRET: SECRETO } as Bindings;
const AHORA = Date.UTC(2026, 10, 13, 18, 0, 0);

const CLABE = '646180157000000004';
const PETICION = { clabeDestino: CLABE, montoCentavos: 18800, referencia: 'GRN-1001-K7' };
const AVISO = {
  idTransferencia: '0b9f6a52-3c1d-4e8a-9f60-2d7c5b1a4e33',
  ...PETICION,
  fecha: '2026-11-13T18:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('firma del aviso del banco', () => {
  it('lo que firma el banco lo acepta el restaurante', async () => {
    const cuerpo = JSON.stringify(AVISO);
    const firma = await firmarAvisoBanco(cuerpo, SECRETO, AHORA);
    expect(firma).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(await verificarFirmaBanco(cuerpo, firma, SECRETO, AHORA)).toBe(true);
  });

  it('coincide con un HMAC-SHA256 calculado con node:crypto (cuerpo con acentos)', async () => {
    const cuerpo = '{"nota":"transferencia de José Ñuñez"}';
    const esperado = createHmac('sha256', SECRETO).update(`${AHORA}.${cuerpo}`).digest('hex');
    expect(await firmarAvisoBanco(cuerpo, SECRETO, AHORA)).toBe(`t=${AHORA},v1=${esperado}`);
  });

  it('acepta el digesto en mayúsculas y hasta 5 minutos de diferencia', async () => {
    const cuerpo = JSON.stringify(AVISO);
    const firma = await firmarAvisoBanco(cuerpo, SECRETO, AHORA);
    const [t, v1] = firma.split(',v1=');
    expect(await verificarFirmaBanco(cuerpo, `${t},v1=${v1?.toUpperCase()}`, SECRETO, AHORA)).toBe(
      true,
    );
    expect(await verificarFirmaBanco(cuerpo, firma, SECRETO, AHORA + 5 * 60_000)).toBe(true);
    expect(await verificarFirmaBanco(cuerpo, firma, SECRETO, AHORA - 5 * 60_000)).toBe(true);
  });

  it('rechaza una firma vencida o del futuro por más de 5 minutos', async () => {
    const cuerpo = JSON.stringify(AVISO);
    const firma = await firmarAvisoBanco(cuerpo, SECRETO, AHORA);
    expect(await verificarFirmaBanco(cuerpo, firma, SECRETO, AHORA + 5 * 60_000 + 1)).toBe(false);
    expect(await verificarFirmaBanco(cuerpo, firma, SECRETO, AHORA - 5 * 60_000 - 1)).toBe(false);
  });

  it('rechaza si el cuerpo cambió, si el secreto es otro o si el digesto se alteró', async () => {
    const cuerpo = JSON.stringify(AVISO);
    const firma = await firmarAvisoBanco(cuerpo, SECRETO, AHORA);
    const otroMonto = JSON.stringify({ ...AVISO, montoCentavos: 1 });
    expect(await verificarFirmaBanco(otroMonto, firma, SECRETO, AHORA)).toBe(false);
    expect(await verificarFirmaBanco(`${cuerpo} `, firma, SECRETO, AHORA)).toBe(false);
    expect(await verificarFirmaBanco(cuerpo, firma, 'otro-secreto', AHORA)).toBe(false);
    const alterada = firma.endsWith('0') ? `${firma.slice(0, -1)}1` : `${firma.slice(0, -1)}0`;
    expect(await verificarFirmaBanco(cuerpo, alterada, SECRETO, AHORA)).toBe(false);
  });

  it.each([
    undefined,
    '',
    'v1=abc',
    `t=${AHORA}`,
    `t=${AHORA},v1=xyz`,
    `v=${AHORA},d=${'a'.repeat(64)}`,
  ])('rechaza el encabezado %j', async (encabezado) => {
    expect(await verificarFirmaBanco('{}', encabezado, SECRETO, AHORA)).toBe(false);
  });
});

describe('transferir (servicio del banco simulado)', () => {
  const deps = (enviarAviso: (cuerpo: string, firma: string) => Promise<boolean>) => ({
    secreto: SECRETO,
    ahora: new Date(AHORA),
    generarId: () => AVISO.idTransferencia,
    enviarAviso,
  });

  it('manda el aviso firmado con los datos de la transferencia, su id y su fecha', async () => {
    const enviados: { cuerpo: string; firma: string }[] = [];
    const transferencia = await transferir(
      PETICION,
      deps((cuerpo, firma) => {
        enviados.push({ cuerpo, firma });
        return Promise.resolve(true);
      }),
    );

    expect(TransferenciaBancoSchema.parse(transferencia)).toEqual({
      ...AVISO,
      montoTexto: '$188.00',
      avisoEntregado: true,
    });
    expect(enviados).toHaveLength(1);
    const [enviado] = enviados;
    expect(AvisoTransferenciaSchema.parse(JSON.parse(enviado?.cuerpo ?? ''))).toEqual(AVISO);
    // La firma es del texto exacto que se mandó.
    expect(await verificarFirmaBanco(enviado?.cuerpo ?? '', enviado?.firma, SECRETO, AHORA)).toBe(
      true,
    );
  });

  it('si el restaurante no responde 2xx, la transferencia queda hecha con avisoEntregado en false', async () => {
    const transferencia = await transferir(
      PETICION,
      deps(() => Promise.resolve(false)),
    );
    expect(transferencia).toMatchObject({ ...AVISO, avisoEntregado: false });
  });

  it('si entregar el aviso lanza un error, tampoco falla la transferencia', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const transferencia = await transferir(
      PETICION,
      deps(() => Promise.reject(new Error('sin red'))),
    );
    expect(transferencia.avisoEntregado).toBe(false);
  });
});

async function pedir(
  ruta: string,
  cuerpo: unknown,
  encabezados: Record<string, string> = {},
  e = env,
) {
  const res = await crearApp().request(
    ruta,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...encabezados },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    },
    e,
  );
  return { status: res.status, json: (await res.json()) as unknown };
}

describe('POST /webhooks/banco', () => {
  const firmado = async (cuerpo: unknown, secreto = SECRETO) => {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return pedir('/webhooks/banco', texto, {
      'X-Banco-Firma': await firmarAvisoBanco(texto, secreto),
    });
  };

  it('con firma válida y el aviso completo responde 200 recibido', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { status, json } = await firmado(AVISO);
    expect(status).toBe(200);
    expect(RespuestaWebhookBancoSchema.parse(json)).toEqual({ recibido: true });
  });

  it('no escribe en el log los datos de la transferencia, solo su id', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await firmado(AVISO);
    const escrito = JSON.stringify(log.mock.calls);
    expect(escrito).toContain(AVISO.idTransferencia);
    expect(escrito).not.toContain(AVISO.referencia);
    expect(escrito).not.toContain(CLABE);
  });

  it('sin firma responde 401, aunque el cuerpo esté mal formado', async () => {
    for (const cuerpo of [AVISO, { basura: true }, '{mal']) {
      const { status, json } = await pedir('/webhooks/banco', cuerpo);
      expect(status).toBe(401);
      expect(ErrorBancoSchema.parse(json).error).toBe('Firma del banco inválida.');
    }
  });

  it('con la firma de otro secreto responde 401', async () => {
    expect((await firmado(AVISO, 'otro-secreto')).status).toBe(401);
  });

  it('con una firma vencida responde 401', async () => {
    const texto = JSON.stringify(AVISO);
    const vieja = await firmarAvisoBanco(texto, SECRETO, Date.now() - 6 * 60_000);
    expect((await pedir('/webhooks/banco', texto, { 'X-Banco-Firma': vieja })).status).toBe(401);
  });

  it.each([
    ['falta la referencia', { ...AVISO, referencia: undefined }],
    ['monto en cero', { ...AVISO, montoCentavos: 0 }],
    ['monto con decimales', { ...AVISO, montoCentavos: 188.5 }],
    ['monto como texto', { ...AVISO, montoCentavos: '18800' }],
    ['CLABE de 17 dígitos', { ...AVISO, clabeDestino: CLABE.slice(1) }],
    ['id que no es uuid', { ...AVISO, idTransferencia: 'abc' }],
    ['fecha sin zona', { ...AVISO, fecha: '2026-11-13 18:00' }],
    ['una llave de más', { ...AVISO, pagado: true }],
    ['JSON mal formado', '{"idTransferencia":'],
  ])('firmado pero con %s responde 400', async (_caso, cuerpo) => {
    const { status, json } = await firmado(cuerpo);
    expect(status).toBe(400);
    expect(ErrorBancoSchema.parse(json).error).toBe('El aviso no tiene el formato esperado.');
  });

  it.each([undefined, '', '   '])('sin BANCO_WEBHOOK_SECRET (%j) responde 500', async (secreto) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const texto = JSON.stringify(AVISO);
    const { status } = await pedir(
      '/webhooks/banco',
      texto,
      { 'X-Banco-Firma': await firmarAvisoBanco(texto, SECRETO) },
      { BANCO_WEBHOOK_SECRET: secreto } as Bindings,
    );
    expect(status).toBe(500);
  });
});

describe('POST /banco-simulado/transferencias', () => {
  it('hace la transferencia y el restaurante recibe el aviso (webhook real de la app)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { status, json } = await pedir('/banco-simulado/transferencias', PETICION);

    expect(status).toBe(201);
    const transferencia = TransferenciaBancoSchema.parse(json);
    expect(transferencia).toMatchObject({
      ...PETICION,
      montoTexto: '$188.00',
      avisoEntregado: true,
    });
    expect(Math.abs(Date.parse(transferencia.fecha) - Date.now())).toBeLessThan(5_000);
    // El webhook anotó el id de ESTA transferencia: el aviso llegó y pasó la firma.
    expect(JSON.stringify(log.mock.calls)).toContain(transferencia.idTransferencia);
  });

  it('cada transferencia tiene su propio id, aunque los datos sean iguales', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = TransferenciaBancoSchema.parse(
      (await pedir('/banco-simulado/transferencias', PETICION)).json,
    );
    const b = TransferenciaBancoSchema.parse(
      (await pedir('/banco-simulado/transferencias', PETICION)).json,
    );
    expect(a.idTransferencia).not.toBe(b.idTransferencia);
  });

  it('no revisa la referencia ni el monto contra ningún pedido: eso es del restaurante', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { status } = await pedir('/banco-simulado/transferencias', {
      ...PETICION,
      montoCentavos: 1,
      referencia: 'NO-EXISTE',
    });
    expect(status).toBe(201);
  });

  it.each([
    ['CLABE con letras', { ...PETICION, clabeDestino: '64618015700000000A' }],
    ['CLABE de 19 dígitos', { ...PETICION, clabeDestino: `${CLABE}1` }],
    ['monto en cero', { ...PETICION, montoCentavos: 0 }],
    ['monto negativo', { ...PETICION, montoCentavos: -100 }],
    ['monto con decimales', { ...PETICION, montoCentavos: 188.5 }],
    ['monto arriba del tope', { ...PETICION, montoCentavos: 10_000_001 }],
    ['referencia vacía', { ...PETICION, referencia: '' }],
    ['referencia con espacios', { ...PETICION, referencia: 'GRN 1001' }],
    ['referencia de 41 caracteres', { ...PETICION, referencia: 'A'.repeat(41) }],
    ['una llave de más', { ...PETICION, idTransferencia: AVISO.idTransferencia }],
    ['JSON mal formado', '{"clabeDestino":'],
  ])('con %s responde 400 y no avisa al restaurante', async (_caso, cuerpo) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { status, json } = await pedir('/banco-simulado/transferencias', cuerpo);
    expect(status).toBe(400);
    expect(ErrorBancoSchema.parse(json).error).toContain('Revisa los datos');
    expect(log).not.toHaveBeenCalled();
  });

  it('sin BANCO_WEBHOOK_SECRET responde 503 y no hace la transferencia', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, json } = await pedir(
      '/banco-simulado/transferencias',
      PETICION,
      {},
      {} as Bindings,
    );
    expect(status).toBe(503);
    expect(ErrorBancoSchema.parse(json).error).toBe(
      'El banco simulado no está disponible en este momento.',
    );
  });

  it('la respuesta nunca trae el secreto ni la firma', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { json } = await pedir('/banco-simulado/transferencias', PETICION);
    expect(JSON.stringify(json)).not.toMatch(/secreto|v1=|firma/i);
  });
});

describe('contrato y Swagger del banco', () => {
  it('la petición del banco es estricta y el monto va en centavos enteros', () => {
    expect(TransferenciaBancoPeticionSchema.safeParse(PETICION).success).toBe(true);
    expect(TransferenciaBancoPeticionSchema.safeParse({ ...PETICION, monto: 188 }).success).toBe(
      false,
    );
  });

  it('las dos rutas y la firma del banco aparecen en /openapi.json', async () => {
    const res = await crearApp().request('/openapi.json', {}, env);
    const doc = (await res.json()) as {
      paths: Record<string, { post?: { security?: unknown } }>;
      components: { securitySchemes: Record<string, { name?: string }> };
    };
    expect(doc.paths['/webhooks/banco']?.post?.security).toEqual([{ FirmaBanco: [] }]);
    expect(doc.paths['/banco-simulado/transferencias']?.post).toBeDefined();
    expect(doc.components.securitySchemes.FirmaBanco?.name).toBe('X-Banco-Firma');
  });
});
