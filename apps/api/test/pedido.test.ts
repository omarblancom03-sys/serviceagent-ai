import {
  CrearPedidoArgsSchema,
  RespuestaCrearPedidoSchema,
  type RenglonCotizacion,
} from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import {
  calcularHuella,
  crearPedido,
  DETALLE_FALTA_NOMBRE,
  DETALLE_FALTA_TELEFONO,
  DETALLE_NOMBRE,
  DETALLE_TELEFONO,
  normalizarNombre,
  normalizarTelefono,
} from '../src/services/pedido';
import { crearRepoMenuEnMemoria, repoMenuQueFalla } from './menuEnMemoria';
import { crearRepoPedidosEnMemoria, repoPedidosQueFalla } from './pedidosEnMemoria';
import { leerSeedMenu } from './seedEnMemoria';

const seed = leerSeedMenu();
const repoMenu = crearRepoMenuEnMemoria(seed.filas, seed.sinonimos);
const AHORA = new Date('2026-10-09T18:00:00Z');
const minutosDespues = (minutos: number) => new Date(AHORA.getTime() + minutos * 60_000);

const CLIENTE = { nombre: 'María José', telefono: '614 123 4567' };
const DOS_TBONE = {
  productos: [{ producto: 't-bone', cantidad: 2, extras: [{ extra: 'espuelas', cantidad: 1 }] }],
};

/** Crea el pedido con el seed real; la petición y la respuesta pasan por el contrato. */
async function crear(args: unknown, repo = crearRepoPedidosEnMemoria(), ahora = AHORA) {
  const respuesta = await crearPedido(repoMenu, repo, CrearPedidoArgsSchema.parse(args), ahora);
  return { respuesta: RespuestaCrearPedidoSchema.parse(respuesta), repo };
}

describe('normalizarTelefono (10 dígitos de México, D32)', () => {
  it.each([
    ['6141234567', '6141234567'],
    ['614 123 4567', '6141234567'],
    ['614-123-45-67', '6141234567'],
    ['(614) 123.4567', '6141234567'],
    ['+52 614 123 4567', '6141234567'],
    ['52 55 1234 5678', '5512345678'],
    ['+521 55 1234 5678', '5512345678'],
    ['5212345678', '5212345678'],
  ])('"%s" → %s', (texto, esperado) => {
    expect(normalizarTelefono(texto)).toBe(esperado);
  });

  it.each(['614123456', '61412345678', '+1 614 123 4567', '614 123 456a', '', 'sin teléfono'])(
    '"%s" no es válido',
    (texto) => {
      expect(normalizarTelefono(texto)).toBeNull();
    },
  );
});

describe('normalizarNombre', () => {
  it.each([
    ['  María   José ', 'María José'],
    ["O'Connor", "O'Connor"],
    ['Ana', 'Ana'],
    ['J. Pérez-López', 'J. Pérez-López'],
  ])('"%s" → "%s"', (texto, esperado) => {
    expect(normalizarNombre(texto)).toBe(esperado);
  });

  it.each(['A', '', '   ', '12345', 'Juan 2', 'juan@correo.com', '..', 'a'.repeat(61)])(
    '"%s" no es válido',
    (texto) => {
      expect(normalizarNombre(texto)).toBeNull();
    },
  );
});

describe('calcularHuella', () => {
  const renglon = (idExtra: number, cantidad: number): RenglonCotizacion => ({
    tipo: 'extra',
    indice: 0,
    idExtra,
    nombre: 'Totopos',
    cantidad,
    precioUnitarioCentavos: 2000,
    precioUnitarioTexto: '$20.00',
    subtotalCentavos: 2000 * cantidad,
    subtotalTexto: '',
  });

  it('es SHA-256 en hex y no depende del orden de los renglones', async () => {
    const a = await calcularHuella([renglon(1, 1), renglon(2, 1)]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await calcularHuella([renglon(2, 1), renglon(1, 1)])).toBe(a);
  });

  it('cambia si cambia la cantidad', async () => {
    expect(await calcularHuella([renglon(1, 2)])).not.toBe(await calcularHuella([renglon(1, 1)]));
  });
});

describe('crearPedido', () => {
  it('cotiza con precios de la base y guarda el pedido con folio 1001 y estado confirmado', async () => {
    const { respuesta, repo } = await crear({ ...DOS_TBONE, ...CLIENTE });

    expect(respuesta).toMatchObject({
      ok: true,
      folio: 1001,
      folioTexto: '#1001',
      estado: 'confirmado',
      yaExistia: false,
      totalCentavos: 91600,
      totalTexto: '$916.00',
    });
    expect(repo.pedidos).toHaveLength(1);
    expect(repo.pedidos[0]).toMatchObject({
      nombreCliente: 'María José',
      telefono: '6141234567',
      totalCentavos: 91600,
      creadoEn: AHORA,
    });
    expect(repo.pedidos[0]?.renglones).toMatchObject([
      { tipo: 'platillo', nombre: 'T-Bone 450 gr', cantidad: 2, extras: [{ cantidad: 1 }] },
    ]);
  });

  it('los folios son consecutivos', async () => {
    const repo = crearRepoPedidosEnMemoria();
    await crear({ ...DOS_TBONE, ...CLIENTE }, repo);
    const { respuesta } = await crear({ ...DOS_TBONE, ...CLIENTE, telefono: '6149998877' }, repo);
    expect(respuesta).toMatchObject({ ok: true, folio: 1002, folioTexto: '#1002' });
  });

  it('si el pedido tiene aclaraciones, no guarda nada y las devuelve', async () => {
    const { respuesta, repo } = await crear({
      productos: [{ producto: 'pizza de pepperoni', cantidad: 1 }],
      ...CLIENTE,
    });

    expect(respuesta).toEqual({
      ok: false,
      aclaraciones: [
        { tipo: 'no_existe', origen: 'producto', indice: 0, producto: 'pizza de pepperoni' },
      ],
      datosCliente: [],
    });
    expect(repo.pedidos).toHaveLength(0);
  });

  it('si el nombre o el teléfono no sirven, no guarda nada y dice qué volver a pedir', async () => {
    const { respuesta, repo } = await crear({ ...DOS_TBONE, nombre: 'J', telefono: '614 123' });

    expect(respuesta).toEqual({
      ok: false,
      aclaraciones: [],
      datosCliente: [
        { campo: 'nombre', detalle: DETALLE_NOMBRE },
        { campo: 'telefono', detalle: DETALLE_TELEFONO },
      ],
    });
    expect(repo.pedidos).toHaveLength(0);
  });

  it('nombre y teléfono que no vinieron (o vinieron null o "") → "falta"', async () => {
    const { respuesta } = await crear({ ...DOS_TBONE, nombre: null, telefono: '' });
    expect(respuesta).toMatchObject({
      ok: false,
      datosCliente: [
        { campo: 'nombre', detalle: DETALLE_FALTA_NOMBRE },
        { campo: 'telefono', detalle: DETALLE_FALTA_TELEFONO },
      ],
    });
  });

  it('junta las aclaraciones del pedido y las del cliente en una sola respuesta', async () => {
    const { respuesta } = await crear({
      productos: [{ producto: 'limonada natural', cantidad: 1 }],
      nombre: 'Ana',
    });
    expect(respuesta).toMatchObject({
      ok: false,
      aclaraciones: [{ tipo: 'falta_variante' }],
      datosCliente: [{ campo: 'telefono' }],
    });
  });

  describe('duplicados (D34)', () => {
    it('el mismo pedido y teléfono dentro de 10 minutos devuelve el mismo folio', async () => {
      const repo = crearRepoPedidosEnMemoria();
      await crear({ ...DOS_TBONE, ...CLIENTE }, repo);
      // Dicho de otra forma, pero es lo mismo: misma huella.
      const otraForma = {
        productos: [
          { producto: 'T-Bone 450 gr', cantidad: 2, extras: [{ extra: 'camarones', cantidad: 1 }] },
        ],
        nombre: 'María José',
        telefono: '+52 614-123-4567',
      };
      const { respuesta } = await crear(otraForma, repo, minutosDespues(9));

      expect(respuesta).toMatchObject({
        ok: true,
        folio: 1001,
        yaExistia: true,
        totalCentavos: 91600,
      });
      expect(repo.pedidos).toHaveLength(1);
    });

    it('pasados 10 minutos ya es un pedido nuevo', async () => {
      const repo = crearRepoPedidosEnMemoria();
      await crear({ ...DOS_TBONE, ...CLIENTE }, repo);
      const { respuesta } = await crear({ ...DOS_TBONE, ...CLIENTE }, repo, minutosDespues(10));
      expect(respuesta).toMatchObject({ ok: true, folio: 1002, yaExistia: false });
    });

    it('otro teléfono o un pedido distinto no cuentan como duplicado', async () => {
      const repo = crearRepoPedidosEnMemoria();
      await crear({ ...DOS_TBONE, ...CLIENTE }, repo);
      const otroTelefono = await crear({ ...DOS_TBONE, ...CLIENTE, telefono: '6140000000' }, repo);
      const unoSolo = await crear(
        { productos: [{ producto: 't-bone', cantidad: 1 }], ...CLIENTE },
        repo,
      );

      expect(otroTelefono.respuesta).toMatchObject({ folio: 1002, yaExistia: false });
      expect(unoSolo.respuesta).toMatchObject({ folio: 1003, yaExistia: false });
    });

    it('un pedido cancelado no cuenta como duplicado', async () => {
      const repo = crearRepoPedidosEnMemoria();
      await crear({ ...DOS_TBONE, ...CLIENTE }, repo);
      const [primero] = repo.pedidos;
      if (primero) primero.estado = 'cancelado';

      const { respuesta } = await crear({ ...DOS_TBONE, ...CLIENTE }, repo, minutosDespues(1));
      expect(respuesta).toMatchObject({ folio: 1002, yaExistia: false });
    });

    it('si ya existía, devuelve el estado que tiene ahora', async () => {
      const repo = crearRepoPedidosEnMemoria();
      await crear({ ...DOS_TBONE, ...CLIENTE }, repo);
      const [primero] = repo.pedidos;
      if (primero) primero.estado = 'en_cola';

      const { respuesta } = await crear({ ...DOS_TBONE, ...CLIENTE }, repo, minutosDespues(1));
      expect(respuesta).toMatchObject({ folio: 1001, yaExistia: true, estado: 'en_cola' });
    });
  });

  it('propaga el error si falla el menú o al guardar (la ruta responderá 500)', async () => {
    const args = CrearPedidoArgsSchema.parse({ ...DOS_TBONE, ...CLIENTE });
    await expect(
      crearPedido(repoMenuQueFalla, crearRepoPedidosEnMemoria(), args, AHORA),
    ).rejects.toThrow('Supabase no responde');
    await expect(crearPedido(repoMenu, repoPedidosQueFalla, args, AHORA)).rejects.toThrow(
      'Supabase no responde',
    );
  });
});
