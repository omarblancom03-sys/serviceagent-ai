import { RespuestaEnviarMensajeSchema } from '@serviceagent/shared';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../src/index';
import { crearClienteRetell } from '../src/lib/clienteRetell';
import type { Bindings } from '../src/lib/env';
import { crearChatRepoEnMemoria } from './chatEnMemoria';

/*
 * US-08-P2-T4 (D69), criterio 3, con la conversación REAL de /pedir del 17-nov (pedido de prueba
 * #1182), tomada de `GET /get-chat` de Retell y limpiada (teléfono, ids y horas ficticios):
 * fixtures/chatConfirmacionReal.json. Cada turno pasa por el cliente de Retell real (su parser),
 * por `sinConfirmacionRepetida` y por `aMensajesAgente`, con un `fetch` falso que responde lo que
 * Retell respondió en ese turno.
 */

interface MensajeCrudo {
  role: string;
  content?: string;
  name?: string;
  [llave: string]: unknown;
}

const RUTA_FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/chatConfirmacionReal.json',
);
const { message_with_tool_calls: CHAT_REAL } = JSON.parse(readFileSync(RUTA_FIXTURE, 'utf-8')) as {
  message_with_tool_calls: MensajeCrudo[];
};

interface Turno {
  cliente: string;
  /** Lo que Retell devolvió en `messages` de create-chat-completion: sin el mensaje del cliente. */
  respuesta: MensajeCrudo[];
}

/** Parte el chat en turnos: cada mensaje del cliente abre uno y lo demás es su respuesta. */
function enTurnos(mensajes: MensajeCrudo[]): Turno[] {
  const turnos: Turno[] = [];
  for (const mensaje of mensajes) {
    if (mensaje.role === 'user') turnos.push({ cliente: mensaje.content ?? '', respuesta: [] });
    else turnos.at(-1)?.respuesta.push(mensaje);
  }
  return turnos;
}

const PREGUNTA = /confirmo tu pedido\?/i;
const env = {
  RETELL_API_KEY: 'llave',
  RETELL_AGENT_ID: 'agent_1',
  TURNSTILE_SECRET_KEY: 'secreto',
} as Bindings;

/** Corre la conversación por la API y devuelve los textos que ve el cliente en cada turno. */
async function conversar(turnos: Turno[]): Promise<string[][]> {
  const pendientes = turnos.map((t) => t.respuesta);
  const fetchFalso: typeof fetch = async (url) => {
    const ruta = String(url);
    if (ruta.endsWith('/create-chat')) {
      return Response.json({ chat_id: 'chat_prueba', chat_status: 'ongoing' });
    }
    if (ruta.endsWith('/create-chat-completion')) {
      return Response.json({ messages: pendientes.shift() ?? [] });
    }
    return Response.json({ chat_status: 'ongoing' });
  };
  const { repo } = crearChatRepoEnMemoria();
  const app = crearApp({
    crearRepoChat: () => repo,
    crearClienteRetell: (llave) => crearClienteRetell(llave, { fetch: fetchFalso }),
    crearVerificadorTurnstile: () => ({ verificar: async () => 'valido' as const }),
  });

  const abierta = await app.request(
    '/chat/conversaciones',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenTurnstile: 'token' }),
    },
    env,
  );
  expect(abierta.status).toBe(201);
  const { conversacionId } = (await abierta.json()) as { conversacionId: string };

  const vistos: string[][] = [];
  for (const { cliente } of turnos) {
    const res = await app.request(
      `/chat/conversaciones/${conversacionId}/mensajes`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: cliente }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const cuerpo = RespuestaEnviarMensajeSchema.parse(await res.json());
    expect(JSON.stringify(cuerpo)).not.toMatch(/cotizar_pedido|crear_pedido|tool_call/);
    vistos.push(cuerpo.mensajes.map((m) => m.texto));
  }
  return vistos;
}

const textosDelAgente = (turnos: Turno[]) =>
  turnos.map((t) => t.respuesta.filter((m) => m.role === 'agent').map((m) => m.content));

describe('conversación real de /pedir (pedido #1182, D69)', () => {
  const turnos = enTurnos(CHAT_REAL);

  it('el fixture trae los 4 mensajes del cliente de la prueba y las 3 llamadas', () => {
    expect(turnos.map((t) => t.cliente)).toEqual([
      'Quiero unas papas francesas para llevar',
      'Así está bien',
      'Prueba Claude, 614 555 0101',
      'Sí',
    ]);
    expect(CHAT_REAL.filter((m) => m.role === 'tool_call_invocation').map((m) => m.name)).toEqual([
      'cotizar_pedido',
      'cotizar_pedido',
      'crear_pedido',
    ]);
  });

  it('el cliente ve "¿Confirmo tu pedido?" una sola vez y todos los mensajes del agente', async () => {
    const vistos = await conversar(turnos);

    // Nada se pierde: también pasa la pregunta del nombre que vino junto al resumen.
    expect(vistos).toEqual(textosDelAgente(turnos));
    expect(vistos.flat().filter((texto) => PREGUNTA.test(texto))).toHaveLength(1);
    expect(vistos.at(-1)?.join(' ')).toContain('#1182');
  });
});

/*
 * DERIVADO DEL REAL. En la conversación real el modelo no repitió la pregunta, así que el filtro
 * no tuvo nada que quitar. Aquí se usa el mismo turno real del resumen y SOLO se le agrega lo que
 * hace el modelo cuando falla (D48): llama a `crear_pedido` sin el "sí", recibe
 * `faltaConfirmacion` y vuelve a preguntar. Los textos reales no se tocan.
 */
describe('derivado del real: el modelo repite la pregunta en el turno del resumen (D69)', () => {
  const turnos = enTurnos(CHAT_REAL);
  const indiceResumen = turnos.findIndex((t) =>
    t.respuesta.some((m) => m.role === 'agent' && PREGUNTA.test(m.content ?? '')),
  );
  const resumenReal = turnos[indiceResumen];
  if (!resumenReal) throw new Error('El fixture no trae el turno del resumen');

  const derivados: Turno[] = turnos.map((turno, i) =>
    i !== indiceResumen
      ? turno
      : {
          ...turno,
          respuesta: [
            ...turno.respuesta,
            {
              role: 'tool_call_invocation',
              message_id: 'msg_derivado_1',
              tool_call_id: 'call_derivado_1',
              name: 'crear_pedido',
              arguments: '{}',
            },
            {
              role: 'tool_call_result',
              message_id: 'msg_derivado_2',
              tool_call_id: 'call_derivado_1',
              content: '{"ok":false,"faltaConfirmacion":true,"aclaraciones":[],"datosCliente":[]}',
            },
            { role: 'agent', message_id: 'msg_derivado_3', content: '¿Confirmo tu pedido?' },
          ],
        },
  );

  it('el cliente ve la pregunta una sola vez: la del resumen real', async () => {
    const vistos = await conversar(derivados);

    expect(vistos).toEqual(textosDelAgente(turnos));
    const preguntas = vistos.flat().filter((texto) => PREGUNTA.test(texto));
    expect(preguntas).toHaveLength(1);
    expect(preguntas[0]).toContain('Tu pedido: 1 Papas francesas');
  });
});
