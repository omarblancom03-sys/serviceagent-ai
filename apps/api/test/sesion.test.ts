import { beforeEach, describe, expect, it } from 'vitest';
import {
  iniciarSesion,
  MAX_INTENTOS_PIN,
  MINUTOS_BLOQUEO,
  type EmpleadosRepo,
} from '../src/services/sesion';
import { crearRepoEnMemoria, IDS, PEPPER_TEST } from './repoEnMemoria';

const T0 = new Date('2026-09-25T12:00:00Z');
const minutosDespues = (minutos: number) => new Date(T0.getTime() + minutos * 60_000);

let repo: EmpleadosRepo;
beforeEach(async () => {
  ({ repo } = await crearRepoEnMemoria());
});

const intentar = (pin: string, ahora = T0, empleadoId: string = IDS.caja) =>
  iniciarSesion(repo, { empleadoId, pin }, PEPPER_TEST, ahora);

describe('iniciarSesion', () => {
  it('con el PIN correcto devuelve el empleado sin datos sensibles', async () => {
    expect(await intentar('2222')).toEqual({
      tipo: 'ok',
      empleado: { id: IDS.caja, nombre: 'Caja de prueba', rol: 'caja' },
    });
  });

  it('con PIN incorrecto descuenta intentos', async () => {
    expect(await intentar('0000')).toEqual({ tipo: 'pin_incorrecto', intentosRestantes: 4 });
    expect(await intentar('0000')).toEqual({ tipo: 'pin_incorrecto', intentosRestantes: 3 });
  });

  it(`bloquea ${MINUTOS_BLOQUEO} minutos al ${MAX_INTENTOS_PIN}.º intento fallido`, async () => {
    for (let i = 1; i < MAX_INTENTOS_PIN; i++) await intentar('0000');

    expect(await intentar('0000')).toEqual({ tipo: 'bloqueado', minutosRestantes: 15 });
  });

  it('mientras está bloqueado rechaza incluso el PIN correcto', async () => {
    for (let i = 0; i < MAX_INTENTOS_PIN; i++) await intentar('0000');

    expect(await intentar('2222', minutosDespues(10))).toEqual({
      tipo: 'bloqueado',
      minutosRestantes: 5,
    });
  });

  it('pasado el bloqueo puede entrar y tiene de nuevo 5 intentos', async () => {
    for (let i = 0; i < MAX_INTENTOS_PIN; i++) await intentar('0000');

    expect(await intentar('0000', minutosDespues(15))).toEqual({
      tipo: 'pin_incorrecto',
      intentosRestantes: 4,
    });
    expect((await intentar('2222', minutosDespues(16))).tipo).toBe('ok');
  });

  it('un acceso correcto reinicia el contador', async () => {
    await intentar('0000');
    await intentar('0000');
    await intentar('2222');

    expect(await intentar('0000')).toEqual({ tipo: 'pin_incorrecto', intentosRestantes: 4 });
  });

  it('el bloqueo es por empleado', async () => {
    for (let i = 0; i < MAX_INTENTOS_PIN; i++) await intentar('0000');

    expect((await intentar('1111', T0, IDS.cocina)).tipo).toBe('ok');
  });

  it('empleado inexistente o inactivo responde igual que un PIN incorrecto', async () => {
    const inexistente = '0f8d7a5e-3c1b-4e2a-9d6f-1a2b3c4d5e99';
    expect(await intentar('4444', T0, IDS.inactivo)).toEqual({
      tipo: 'pin_incorrecto',
      intentosRestantes: MAX_INTENTOS_PIN,
    });
    expect((await intentar('1111', T0, inexistente)).tipo).toBe('pin_incorrecto');
  });
});
