import { describe, expect, it } from 'vitest';
import { idDelChat, llavesDelChat, MAX_LARGO_ID_CHAT } from '../src/lib/chatRetell';

describe('idDelChat', () => {
  it('lee chat.chat_id e ignora el resto del objeto', () => {
    expect(idDelChat({ chat_id: 'chat_abc', transcript: 'User: hola' })).toBe('chat_abc');
  });

  it('acepta hasta 128 caracteres', () => {
    expect(idDelChat({ chat_id: 'c'.repeat(MAX_LARGO_ID_CHAT) })).toHaveLength(128);
  });

  it.each([
    ['sin chat', undefined],
    ['null', null],
    ['texto', 'chat_abc'],
    ['lista', [{ chat_id: 'chat_abc' }]],
    ['sin la llave', { call_id: 'chat_abc' }],
    ['vacío', { chat_id: '' }],
    ['número', { chat_id: 123 }],
    ['129 caracteres', { chat_id: 'c'.repeat(129) }],
  ])('%s → null', (_caso, chat) => {
    expect(idDelChat(chat)).toBeNull();
  });
});

describe('llavesDelChat', () => {
  it('devuelve solo los nombres de las llaves, nunca los valores', () => {
    const llaves = llavesDelChat({ transcript: 'User: secreto', chat_status: 'ongoing' });
    expect(llaves).toEqual(['transcript', 'chat_status']);
    expect(JSON.stringify(llaves)).not.toContain('secreto');
  });

  it.each([undefined, null, 'texto', ['a']])('%j → lista vacía', (chat) => {
    expect(llavesDelChat(chat)).toEqual([]);
  });
});
