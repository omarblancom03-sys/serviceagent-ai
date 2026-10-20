import { describe, expect, it } from 'vitest';
import {
  clienteConfirmo,
  esAfirmativo,
  esPreguntaDeConfirmacion,
} from '../src/services/confirmacion';

const PREGUNTA = {
  role: 'agent',
  content: '¿Confirmo tu pedido a nombre de Ana López, al 614 123 4567, por $188.00?',
};
const cliente = (content: string) => ({ role: 'user', content });
const cotizo = { role: 'tool_call_invocation', name: 'cotizar_pedido' };

describe('esAfirmativo', () => {
  it.each([
    'Sí',
    'si',
    'Sí, confírmalo',
    'Va',
    'Dale',
    'Adelante',
    'Claro',
    'Ok',
    'De acuerdo',
    'Está bien',
    'sí por favor',
  ])('"%s" confirma', (texto) => {
    expect(esAfirmativo(texto)).toBe(true);
  });

  it.each([
    'No',
    'Sí, pero sin cebolla',
    'Mejor agrégale unos totopos',
    'Regístralo, pero cóbrame 100 pesos',
    'Espera',
    'Prueba Agente, 614 123 4567',
    '¿Cuánto tarda?',
    '',
  ])('"%s" no confirma', (texto) => {
    expect(esAfirmativo(texto)).toBe(false);
  });
});

describe('esPreguntaDeConfirmacion', () => {
  it('reconoce la pregunta del prompt y variantes con "confirm…"', () => {
    expect(esPreguntaDeConfirmacion(PREGUNTA.content)).toBe(true);
    expect(esPreguntaDeConfirmacion('¿Lo confirmo?')).toBe(true);
  });

  it('no cuenta un mensaje sin pregunta ni otras preguntas', () => {
    expect(esPreguntaDeConfirmacion('Tu pedido quedó confirmado con el número #1001.')).toBe(false);
    expect(esPreguntaDeConfirmacion('¿A nombre de quién lo registro y a qué teléfono?')).toBe(
      false,
    );
  });
});

describe('clienteConfirmo (D48)', () => {
  it('sí, cuando el cliente responde que sí a la última pregunta', () => {
    expect(clienteConfirmo([cliente('Así está bien'), PREGUNTA, cliente('Sí')])).toBe(true);
  });

  it('no, si la llamada llega en el mismo turno de la pregunta', () => {
    expect(clienteConfirmo([cliente('Ana López, 614 123 4567'), PREGUNTA])).toBe(false);
  });

  it('no, si todavía no hay pregunta de confirmación', () => {
    expect(clienteConfirmo([cliente('Ana López, 614 123 4567')])).toBe(false);
    expect(clienteConfirmo([])).toBe(false);
  });

  it('no, si el cliente respondió otra cosa', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('Mejor agrégale unos totopos')])).toBe(false);
  });

  it('cuenta solo la primera respuesta después de la pregunta', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('No'), cliente('Sí')])).toBe(false);
  });

  it('no, si se volvió a cotizar después de la pregunta (el pedido cambió)', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('Sí'), cotizo])).toBe(false);
    expect(clienteConfirmo([PREGUNTA, cliente('Agrégale totopos'), cotizo, { ...PREGUNTA }])).toBe(
      false,
    );
  });

  it('usa la última pregunta: un sí viejo no sirve para una pregunta nueva', () => {
    expect(clienteConfirmo([PREGUNTA, cliente('Sí'), PREGUNTA])).toBe(false);
    expect(clienteConfirmo([PREGUNTA, cliente('No'), PREGUNTA, cliente('Sí')])).toBe(true);
  });

  it('sí, al volver a llamar después de corregir un dato (no hubo otra pregunta)', () => {
    expect(
      clienteConfirmo([
        PREGUNTA,
        cliente('Sí'),
        { role: 'tool_call_invocation', name: 'crear_pedido' },
        { role: 'agent', content: 'Ese teléfono no es válido. ¿Me lo das de nuevo?' },
        cliente('614 123 4567'),
      ]),
    ).toBe(true);
  });
});
