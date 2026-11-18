import { RespuestaCancelarPedidoSchema, type RespuestaCancelarPedido } from '@serviceagent/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import type { Bindings } from '../src/lib/env';
import {
  cancelarPedido,
  DETALLE_RECHAZO,
  MAX_FOLIOS_NO_ENCONTRADOS,
  type CancelacionesRepo,
} from '../src/services/cancelacion';
import { crearRepoCancelacionesEnMemoria, pedidoCancelable } from './cancelacionesEnMemoria';
import { firmar } from './firmaDePrueba';

/* US-14-T2 (D79): límite de folios no encontrados por conversación al cancelar. */

const LLAVE = 'key_llave_de_prueba_con_badge_de_webhook';
const env = { RETELL_API_KEY: LLAVE } as Bindings;
const TELEFONO = '6141234567';
const MOTIVO = 'Ya no va a poder pasar por él.';

/** Conversación en la que el cliente ya dijo que sí a "¿Cancelo tu pedido #folio?" (D73 y D74). */
const confirmadaPara = (folio: number) => [
  { role: 'agent', content: `¿Cancelo tu pedido #${folio}?` },
  { role: 'user', content: 'Sí' },
];

const DEMASIADOS = {
  ok: false,
  rechazo: 'demasiados_intentos',
  estadoActual: null,
  detalle: DETALLE_RECHAZO.demasiados_intentos,
  faltaFolio: false,
  datosCliente: [],
  aclaracionMotivo: null,
  faltaConfirmacion: false,
};

/** Llama a la ruta como Retell, con `chat` tal cual (para probar un chat sin `chat_id`). */
async function cancelar(folio: number, repo: CancelacionesRepo, chat: Record<string, unknown>) {
  const cuerpo = JSON.stringify({
    name: 'cancelar_pedido',
    chat: { message_with_tool_calls: confirmadaPara(folio), ...chat },
    args: { folio, telefono: TELEFONO, motivo: MOTIVO },
  });
  const res = await crearApp({ crearRepoCancelaciones: () => repo }).request(
    '/pedidos/cancelar',
    {
      method: 'POST',
      body: cuerpo,
      headers: {
        'Content-Type': 'application/json',
        'X-Retell-Signature': await firmar(cuerpo, LLAVE, Date.now()),
      },
    },
    env,
  );
  expect(res.status).toBe(200);
  return RespuestaCancelarPedidoSchema.parse(await res.json());
}

/** El `rechazo` de la respuesta, o `null` si canceló. */
const rechazoDe = (r: RespuestaCancelarPedido) => (r.ok ? null : r.rechazo);

const enChat = (folio: number, repo: CancelacionesRepo, idChat = 'chat_1') =>
  cancelar(folio, repo, { chat_id: idChat });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /pedidos/cancelar: límite de folios no encontrados (D79)', () => {
  it('el límite arranca en 3', () => {
    expect(MAX_FOLIOS_NO_ENCONTRADOS).toBe(3);
  });

  it('después de 3 folios no encontrados, ni el folio correcto se cancela ni se dice si existe', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);

    for (const folio of [4001, 4002, 4003]) {
      expect(rechazoDe(await enChat(folio, repo))).toBe('no_encontrado');
    }
    expect(await enChat(1001, repo)).toEqual(DEMASIADOS);
    expect(await enChat(4004, repo)).toEqual(DEMASIADOS);
    expect(repo.pedidos[0]?.estado).toBe('en_cola');
    expect(repo.noEncontrados.get('chat_1')).toBe(3);
  });

  it('un folio de otro teléfono también cuenta: si no, el límite delataría qué folios existen', async () => {
    const repo = crearRepoCancelacionesEnMemoria([
      pedidoCancelable(1001, 'en_cola'),
      pedidoCancelable(2001, 'en_cola', { telefono: '6149998877' }),
      pedidoCancelable(2002, 'en_cola', { telefono: '6149998877' }),
      pedidoCancelable(2003, 'en_cola', { telefono: '6149998877' }),
    ]);

    for (const folio of [2001, 2002, 2003]) {
      expect(rechazoDe(await enChat(folio, repo))).toBe('no_encontrado');
    }
    expect(repo.noEncontrados.get('chat_1')).toBe(3);
    expect(await enChat(1001, repo)).toEqual(DEMASIADOS);
    expect(repo.pedidos.map((p) => p.estado)).toEqual(['en_cola', 'en_cola', 'en_cola', 'en_cola']);
  });

  it('con 2 no encontrados todavía cancela, y encontrar el pedido no reinicia la cuenta', async () => {
    const repo = crearRepoCancelacionesEnMemoria([
      pedidoCancelable(1001, 'en_cola'),
      pedidoCancelable(1002, 'en_cola'),
    ]);

    await enChat(4001, repo);
    await enChat(4002, repo);
    expect((await enChat(1001, repo)).ok).toBe(true);
    expect(repo.noEncontrados.get('chat_1')).toBe(2);

    expect(rechazoDe(await enChat(4003, repo))).toBe('no_encontrado');
    expect(await enChat(1002, repo)).toEqual(DEMASIADOS);
    expect(repo.pedidos[1]?.estado).toBe('en_cola');
  });

  it('cada conversación lleva su propia cuenta', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);

    for (const folio of [4001, 4002, 4003]) await enChat(folio, repo, 'chat_1');
    expect((await enChat(1001, repo, 'chat_2')).ok).toBe(true);
  });

  it('sin chat.chat_id responde demasiados_intentos sin tocar la base', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);

    expect(await cancelar(1001, repo, {})).toEqual(DEMASIADOS);
    expect(await cancelar(1001, repo, { chat_id: '' })).toEqual(DEMASIADOS);
    expect(repo.llamadas).toBe(0);
    expect(repo.pedidos[0]?.estado).toBe('en_cola');
    expect(aviso).toHaveBeenCalledWith('POST /pedidos/cancelar sin chat.chat_id', {
      llaves: ['message_with_tool_calls'],
    });
  });

  it('el detalle no dice si el folio existe y manda al cliente al restaurante', () => {
    const detalle = DETALLE_RECHAZO.demasiados_intentos;
    expect(detalle).not.toMatch(/no existe|no se encontr|encontrado|intentos/i);
    expect(detalle).toContain('en el restaurante con su número de pedido');
  });

  it('Swagger documenta el rechazo', async () => {
    const res = await crearApp().request('/openapi.json', {}, env);
    expect(JSON.stringify(await res.json())).toContain('demasiados_intentos');
  });
});

describe('cancelarPedido (servicio): sin id del chat', () => {
  it('no llama al repo y responde demasiados_intentos', async () => {
    const repo = crearRepoCancelacionesEnMemoria([pedidoCancelable(1001, 'en_cola')]);
    const respuesta = await cancelarPedido(
      repo,
      { folio: 1001, telefono: TELEFONO, motivo: MOTIVO },
      confirmadaPara(1001),
      null,
    );
    expect(respuesta).toEqual(DEMASIADOS);
    expect(repo.llamadas).toBe(0);
  });
});
