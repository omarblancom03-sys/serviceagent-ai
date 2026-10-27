import { RespuestaTransferirAEmpleadoSchema } from '@serviceagent/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import type { AlertasRepo } from '../src/services/alerta';
import { DETALLE_FALTA_TELEFONO, DETALLE_NOMBRE, DETALLE_TELEFONO } from '../src/services/pedido';
import { DETALLE_MOTIVO_LARGO } from '../src/services/alerta';
import { crearRepoAlertasEnMemoria, repoAlertasQueFalla } from './alertasEnMemoria';
import { firmar } from './firmaDePrueba';

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const env = { RETELL_API_KEY: LLAVE } as Bindings;
const ID_CHAT = 'chat_5f2a9c0e1b7d4e8a9f3c6b2d1e0a';
const TEXTO_PRIVADO = 'mi tarjeta termina en 4242 y vivo en Calle Secreta 123';

/** Un `chat` como el de un chat real de Retell: trae la transcripción, que la API ignora. */
const chatReal = (chatId: unknown = ID_CHAT) => ({
  chat_id: chatId,
  agent_id: 'agent_abc',
  agent_version: 3,
  chat_type: 'api_chat',
  chat_status: 'ongoing',
  transcript: `User: ${TEXTO_PRIVADO}`,
  message_with_tool_calls: [{ role: 'user', content: TEXTO_PRIVADO }],
});

const argsBuenos = { telefono: '6141234567', nombre: 'Ana López', motivo: 'Quiere factura.' };

/** Cuerpo como lo manda Retell en un agente de chat: `{ name, chat, args }`. */
const sobre = (args: unknown, chat: unknown = chatReal(), name = 'transferir_a_empleado') =>
  JSON.stringify({ name, chat, args });

function nuevaApp(repo: AlertasRepo = crearRepoAlertasEnMemoria()) {
  return crearApp({ crearRepoAlertas: () => repo });
}

async function escalar(
  cuerpo: string,
  {
    aplicacion = nuevaApp(),
    firma,
    entorno = env,
  }: { aplicacion?: ReturnType<typeof crearApp>; firma?: string | null; entorno?: Bindings } = {},
) {
  const encabezado = firma === undefined ? await firmar(cuerpo, LLAVE, Date.now()) : firma;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (encabezado !== null) headers['X-Retell-Signature'] = encabezado;
  return aplicacion.request('/agente/escalar', { method: 'POST', body: cuerpo, headers }, entorno);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /agente/escalar: firma y formato', () => {
  it('401 sin firma, con firma que no corresponde o vencida, sin llamar al repo', async () => {
    const repo = crearRepoAlertasEnMemoria();
    const aplicacion = nuevaApp(repo);
    const cuerpo = sobre(argsBuenos);
    const vencida = await firmar(cuerpo, LLAVE, Date.now() - 6 * 60_000);

    for (const firma of [null, await firmar('otro', LLAVE, Date.now()), vencida]) {
      expect((await escalar(cuerpo, { aplicacion, firma })).status).toBe(401);
    }
    expect(repo.llamadas).toBe(0);
  });

  it('500 si falta RETELL_API_KEY', async () => {
    const res = await escalar(sobre(argsBuenos), { entorno: {} as Bindings });
    expect(res.status).toBe(500);
  });

  it.each([
    ['llave de más', { ...argsBuenos, prioridad: 'alta' }, 'args.prioridad'],
    ['sin motivo', { telefono: '6141234567' }, 'args.motivo'],
    ['motivo de solo espacios', { ...argsBuenos, motivo: '   ' }, 'args.motivo'],
    ['motivo de más de 1000', { ...argsBuenos, motivo: 'a'.repeat(1001) }, 'args.motivo'],
    ['folio decimal', { ...argsBuenos, folio: 1001.5 }, 'args.folio'],
    ['folio negativo', { ...argsBuenos, folio: -3 }, 'args.folio'],
  ])('%s: 400 que nombra el campo', async (_caso, args, campo) => {
    const res = await escalar(sobre(args));

    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({
      error: expect.stringContaining(campo),
    });
  });

  it('400 si la función no es transferir_a_empleado', async () => {
    expect((await escalar(sobre(argsBuenos, chatReal(), 'cotizar_pedido'))).status).toBe(400);
  });
});

describe('POST /agente/escalar: alerta', () => {
  it('crea la alerta con el teléfono normalizado y sin la conversación', async () => {
    const repo = crearRepoAlertasEnMemoria();
    const res = await escalar(sobre({ ...argsBuenos, telefono: '+52 (614) 123-4567' }), {
      aplicacion: nuevaApp(repo),
    });

    expect(res.status).toBe(200);
    expect(RespuestaTransferirAEmpleadoSchema.parse(await res.json())).toEqual({
      ok: true,
      yaSeAviso: false,
      folioNoEncontrado: false,
    });
    expect(repo.alertas).toEqual([
      {
        idChat: ID_CHAT,
        telefono: '6141234567',
        nombreCliente: 'Ana López',
        folio: null,
        motivo: 'Quiere factura.',
      },
    ]);
  });

  it('con una pendiente, la misma conversación no crea otra (yaSeAviso); otra conversación sí', async () => {
    const repo = crearRepoAlertasEnMemoria();
    const aplicacion = nuevaApp(repo);

    const primera = await (await escalar(sobre(argsBuenos), { aplicacion })).json();
    const segunda = await (await escalar(sobre(argsBuenos), { aplicacion })).json();
    expect(primera).toMatchObject({ ok: true, yaSeAviso: false });
    expect(segunda).toMatchObject({ ok: true, yaSeAviso: true });
    expect(repo.alertas).toHaveLength(1);

    await escalar(sobre(argsBuenos, chatReal('chat_otro')), { aplicacion });
    expect(repo.alertas).toHaveLength(2);
  });

  it('ya atendida, la misma conversación puede crear otra alerta', async () => {
    const repo = crearRepoAlertasEnMemoria();
    const aplicacion = nuevaApp(repo);

    await escalar(sobre(argsBuenos), { aplicacion });
    expect(await repo.marcarAtendida(1, '00000000-0000-4000-8000-000000000002')).toMatchObject({
      resultado: 'atendida',
    });

    const otra = await (await escalar(sobre(argsBuenos), { aplicacion })).json();
    expect(otra).toMatchObject({ ok: true, yaSeAviso: false });
    expect(repo.alertas.map((a) => a.idChat)).toEqual([ID_CHAT, ID_CHAT]);

    // La nueva queda pendiente: repetirla otra vez vuelve a dar yaSeAviso.
    const repetida = await (await escalar(sobre(argsBuenos), { aplicacion })).json();
    expect(repetida).toMatchObject({ ok: true, yaSeAviso: true });
    expect(repo.alertas).toHaveLength(2);
  });

  it.each([undefined, null, ''])(
    'sin nombre (%s) crea la alerta con nombre vacío',
    async (nombre) => {
      const repo = crearRepoAlertasEnMemoria();
      await escalar(sobre({ ...argsBuenos, nombre }), { aplicacion: nuevaApp(repo) });
      expect(repo.alertas[0]?.nombreCliente).toBeNull();
    },
  );

  it('un motivo de exactamente 200 caracteres se guarda', async () => {
    const repo = crearRepoAlertasEnMemoria();
    const res = await escalar(sobre({ ...argsBuenos, motivo: 'a'.repeat(200) }), {
      aplicacion: nuevaApp(repo),
    });
    expect(await res.json()).toMatchObject({ ok: true });
    expect(repo.alertas[0]?.motivo).toHaveLength(200);
  });

  it('folio: se guarda si es de ese teléfono; si no, sin folio y folioNoEncontrado', async () => {
    const repo = crearRepoAlertasEnMemoria([
      { folio: 1001, telefono: '6141234567' },
      { folio: 1002, telefono: '6149999999' },
    ]);
    const aplicacion = nuevaApp(repo);

    const propio = await escalar(sobre({ ...argsBuenos, folio: 1001 }, chatReal('chat_1')), {
      aplicacion,
    });
    const ajeno = await escalar(sobre({ ...argsBuenos, folio: 1002 }, chatReal('chat_2')), {
      aplicacion,
    });
    const inexistente = await escalar(sobre({ ...argsBuenos, folio: 5000 }, chatReal('chat_3')), {
      aplicacion,
    });

    expect(await propio.json()).toMatchObject({ ok: true, folioNoEncontrado: false });
    expect(await ajeno.json()).toMatchObject({ ok: true, folioNoEncontrado: true });
    expect(await inexistente.json()).toMatchObject({ ok: true, folioNoEncontrado: true });
    expect(repo.alertas.map((a) => a.folio)).toEqual([1001, null, null]);
  });

  it.each([null, ''])('folio %j vale como "no vino"', async (folio) => {
    const repo = crearRepoAlertasEnMemoria();
    const res = await escalar(sobre({ ...argsBuenos, folio }), { aplicacion: nuevaApp(repo) });
    expect(await res.json()).toMatchObject({ ok: true, folioNoEncontrado: false });
    expect(repo.alertas[0]?.folio).toBeNull();
  });

  it('500 con texto genérico si falla la base', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await escalar(sobre(argsBuenos), { aplicacion: nuevaApp(repoAlertasQueFalla) });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'No se pudo avisar a un empleado. Intenta de nuevo en un momento.',
    });
  });
});

describe('POST /agente/escalar: lo que hay que corregir (200 sin tocar la base)', () => {
  it.each([
    ['teléfono corto', { ...argsBuenos, telefono: '123' }, 'telefono', DETALLE_TELEFONO],
    ['teléfono con 0', { ...argsBuenos, telefono: '0141234567' }, 'telefono', DETALLE_TELEFONO],
    ['sin teléfono', { nombre: 'Ana', motivo: 'Ayuda' }, 'telefono', DETALLE_FALTA_TELEFONO],
    ['nombre de una letra', { ...argsBuenos, nombre: 'A' }, 'nombre', DETALLE_NOMBRE],
    ['nombre con número', { ...argsBuenos, nombre: 'J0rge' }, 'nombre', DETALLE_NOMBRE],
  ])('%s', async (_caso, args, campo, detalle) => {
    const repo = crearRepoAlertasEnMemoria();
    const res = await escalar(sobre(args), { aplicacion: nuevaApp(repo) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      sinConversacion: false,
      datosCliente: [{ campo, detalle }],
      aclaracionMotivo: null,
    });
    expect(repo.llamadas).toBe(0);
  });

  it('motivo de 201 a 1000 caracteres: pide resumirlo', async () => {
    const repo = crearRepoAlertasEnMemoria();
    for (const largo of [201, 1000]) {
      const res = await escalar(sobre({ ...argsBuenos, motivo: 'a'.repeat(largo) }), {
        aplicacion: nuevaApp(repo),
      });
      expect(await res.json()).toEqual({
        ok: false,
        sinConversacion: false,
        datosCliente: [],
        aclaracionMotivo: DETALLE_MOTIVO_LARGO,
      });
    }
    expect(repo.llamadas).toBe(0);
  });

  it.each([
    ['sin chat', undefined],
    ['chat null', null],
    ['chat que no es objeto', 'chat_123'],
    ['chat sin chat_id', { transcript: `User: ${TEXTO_PRIVADO}` }],
    ['chat_id vacío', chatReal('')],
    ['chat_id numérico', chatReal(123)],
    ['chat_id de 129 caracteres', chatReal('c'.repeat(129))],
  ])('%s: sinConversacion, sin 400 ni 500 y sin tocar la base', async (_caso, chat) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repo = crearRepoAlertasEnMemoria();
    const cuerpo = JSON.stringify({ name: 'transferir_a_empleado', chat, args: argsBuenos });
    const res = await escalar(cuerpo, { aplicacion: nuevaApp(repo) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      sinConversacion: true,
      datosCliente: [],
      aclaracionMotivo: null,
    });
    expect(repo.llamadas).toBe(0);
  });
});

describe('POST /agente/escalar: privacidad', () => {
  it('ni el log ni la respuesta traen la transcripción, el chat_id ni los datos del cliente', async () => {
    const escrito: unknown[] = [];
    for (const nivel of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, nivel).mockImplementation((...args) => escrito.push(args));
    }
    const aplicacion = nuevaApp(crearRepoAlertasEnMemoria());

    const respuestas = [
      await escalar(sobre(argsBuenos), { aplicacion }),
      await escalar(sobre(argsBuenos), { aplicacion }),
      await escalar(sobre(argsBuenos, { ...chatReal(), chat_id: undefined }), { aplicacion }),
      await escalar(sobre(argsBuenos), { aplicacion: nuevaApp(repoAlertasQueFalla) }),
    ];
    const textos = [
      JSON.stringify(escrito),
      ...(await Promise.all(respuestas.map((r) => r.text()))),
    ];

    for (const texto of textos) {
      for (const privado of [TEXTO_PRIVADO, '4242', ID_CHAT, '6141234567', 'Ana', 'factura']) {
        expect(texto).not.toContain(privado);
      }
    }
    // Sin chat_id el log anota solo los nombres de las llaves.
    expect(JSON.stringify(escrito)).toContain('message_with_tool_calls');
  });
});

describe('POST /agente/escalar en Swagger', () => {
  it('aparece en /openapi.json con sus respuestas y la firma de Retell', async () => {
    const res = await nuevaApp().request('/openapi.json');
    const doc = (await res.json()) as {
      paths: Record<string, { post?: { responses: Record<string, unknown>; security: unknown } }>;
    };
    const ruta = doc.paths['/agente/escalar']?.post;

    expect(ruta?.security).toEqual([{ FirmaRetell: [] }]);
    expect(Object.keys(ruta?.responses ?? {}).sort()).toEqual(['200', '400', '401', '500']);
  });
});
