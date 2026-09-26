import { describe, expect, it } from 'vitest';
import { hashPin, ITERACIONES_PIN, verificarPin } from '../src/lib/pin';
import { PEPPER_TEST } from './repoEnMemoria';

const OTRO_PEPPER = 'otro-pepper-distinto-con-al-menos-32-caracteres';

describe('hashPin', () => {
  it('guarda algoritmo, iteraciones, sal y hash; nunca el PIN ni el pepper', async () => {
    const hash = await hashPin('1234', PEPPER_TEST);

    expect(hash).toMatch(/^pbkdf2_sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(hash.split('$')[1]).toBe(String(ITERACIONES_PIN));
    expect(hash).not.toContain('1234');
    expect(hash).not.toContain(PEPPER_TEST);
  });

  it('usa una sal distinta cada vez', async () => {
    expect(await hashPin('1234', PEPPER_TEST, 1_000)).not.toBe(
      await hashPin('1234', PEPPER_TEST, 1_000),
    );
  });

  it('se niega a trabajar sin un pepper de al menos 32 caracteres', async () => {
    await expect(hashPin('1234', '')).rejects.toThrow(/PIN_PEPPER/);
    await expect(hashPin('1234', 'corto')).rejects.toThrow(/openssl rand -base64 32/);
  });
});

describe('verificarPin', () => {
  it('acepta el PIN correcto y rechaza uno incorrecto', async () => {
    const hash = await hashPin('1234', PEPPER_TEST, 1_000);

    expect(await verificarPin('1234', hash, PEPPER_TEST)).toBe(true);
    expect(await verificarPin('1235', hash, PEPPER_TEST)).toBe(false);
  });

  it('con otro pepper el PIN correcto no coincide (un hash robado no sirve sin el pepper)', async () => {
    const hash = await hashPin('1234', PEPPER_TEST, 1_000);
    expect(await verificarPin('1234', hash, OTRO_PEPPER)).toBe(false);
  });

  it('sin pepper lanza error en vez de responder "PIN incorrecto"', async () => {
    const hash = await hashPin('1234', PEPPER_TEST, 1_000);
    await expect(verificarPin('1234', hash, '')).rejects.toThrow(/PIN_PEPPER/);
  });

  it('respeta las iteraciones guardadas en el hash', async () => {
    const hash = await hashPin('9876', PEPPER_TEST, 3_000);
    expect(await verificarPin('9876', hash, PEPPER_TEST)).toBe(true);
  });

  it.each([
    ['vacío', ''],
    ['texto plano', '1234'],
    ['otro algoritmo', 'bcrypt$1000$c2Fs$aGFzaA=='],
    ['iteraciones inválidas', 'pbkdf2_sha256$abc$c2Fs$aGFzaA=='],
    ['base64 inválido', 'pbkdf2_sha256$1000$%%%$aGFzaA=='],
    ['partes de más', 'pbkdf2_sha256$1000$c2Fs$aGFzaA==$extra'],
  ])('rechaza un hash con formato inválido (%s)', async (_caso, guardado) => {
    expect(await verificarPin('1234', guardado, PEPPER_TEST)).toBe(false);
  });
});
