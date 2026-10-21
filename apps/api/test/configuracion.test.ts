import { ConfiguracionRestauranteSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { crearRepoConfiguracion } from '../src/lib/repoConfiguracion';
import { crearRepoPedidos } from '../src/lib/repoPedidos';
import { cambiarModoPago, obtenerConfiguracion } from '../src/services/configuracion';
import { crearRepoConfiguracionEnMemoria } from './configuracionEnMemoria';

const EMPLEADO = '00000000-0000-4000-8000-000000000003';

describe('configuración del restaurante (US-22)', () => {
  it('al inicio el modo es pago al recoger y nadie lo ha cambiado', async () => {
    const configuracion = await obtenerConfiguracion(crearRepoConfiguracionEnMemoria());
    expect(configuracion).toEqual({
      modoPago: 'al_recoger',
      actualizadoEn: '2026-10-21T06:00:00.000Z',
      actualizadoPor: null,
    });
    expect(ConfiguracionRestauranteSchema.safeParse(configuracion).success).toBe(true);
  });

  it('cambiar el modo guarda quién y cuándo, y devuelve cómo quedó', async () => {
    const repo = crearRepoConfiguracionEnMemoria({ [EMPLEADO]: 'Admin de prueba' });
    const configuracion = await cambiarModoPago(repo, 'transferencia', EMPLEADO);
    expect(configuracion).toEqual({
      modoPago: 'transferencia',
      actualizadoEn: '2026-10-21T18:00:00.000Z',
      actualizadoPor: 'Admin de prueba',
    });
    expect(repo.historial).toEqual([{ modoPago: 'transferencia', idEmpleado: EMPLEADO }]);
  });

  it('elegir el modo que ya está no deja historial', async () => {
    const repo = crearRepoConfiguracionEnMemoria();
    await cambiarModoPago(repo, 'al_recoger', EMPLEADO);
    expect(repo.historial).toEqual([]);
  });
});

/** Cliente de Supabase falso para la configuración: `from().select().single()` y `rpc()`. */
function clienteConfiguracion(fila: unknown, errorRpc: { message: string } | null = null) {
  const llamadas: { columnas?: string; rpc?: { nombre: string; args: unknown } } = {};
  const cliente = {
    from(tabla: string) {
      expect(tabla).toBe('configuracion_restaurante');
      return {
        select(columnas: string) {
          llamadas.columnas = columnas;
          return { single: () => Promise.resolve({ data: fila, error: null }) };
        },
      };
    },
    rpc(nombre: string, args: unknown) {
      llamadas.rpc = { nombre, args };
      return Promise.resolve({ data: null, error: errorRpc });
    },
  } as unknown as SupabaseClient;
  return { cliente, llamadas };
}

describe('crearRepoConfiguracion (Supabase)', () => {
  it('lee la fila con el nombre del empleado del último cambio', async () => {
    const { cliente, llamadas } = clienteConfiguracion({
      modo_pago: 'transferencia',
      actualizado_en: '2026-10-21T18:00:00+00:00',
      empleados: { nombre: 'Admin de prueba' },
    });
    expect(await crearRepoConfiguracion(cliente).leer()).toEqual({
      modoPago: 'transferencia',
      actualizadoEn: new Date('2026-10-21T18:00:00Z'),
      actualizadoPor: 'Admin de prueba',
    });
    expect(llamadas.columnas).toBe('modo_pago, actualizado_en, empleados(nombre)');
  });

  it('sin cambios todavía, no hay empleado', async () => {
    const { cliente } = clienteConfiguracion({
      modo_pago: 'al_recoger',
      actualizado_en: '2026-10-21T06:00:00+00:00',
      empleados: null,
    });
    expect((await crearRepoConfiguracion(cliente).leer()).actualizadoPor).toBeNull();
  });

  it('cambia el modo con la función SQL, con el empleado de la sesión', async () => {
    const { cliente, llamadas } = clienteConfiguracion(null);
    await crearRepoConfiguracion(cliente).cambiarModoPago('transferencia', EMPLEADO);
    expect(llamadas.rpc).toEqual({
      nombre: 'cambiar_modo_pago',
      args: { p_modo_pago: 'transferencia', p_id_empleado: EMPLEADO },
    });
  });

  it('si la función SQL falla, lanza un error con su mensaje', async () => {
    const { cliente } = clienteConfiguracion(null, { message: 'sin permiso' });
    await expect(
      crearRepoConfiguracion(cliente).cambiarModoPago('al_recoger', EMPLEADO),
    ).rejects.toThrow('No se pudo cambiar el modo de pago: sin permiso');
  });
});

describe('crearRepoPedidos: modo de pago (US-22)', () => {
  const pedido = {
    nombreCliente: 'María José',
    telefono: '6141234567',
    huella: 'a'.repeat(64),
    totalCentavos: 14900,
    renglones: [],
  };
  const clienteRpc = (fila: unknown) =>
    ({ rpc: () => Promise.resolve({ data: [fila], error: null }) }) as unknown as SupabaseClient;

  it('lee el modo con que se guardó el pedido', async () => {
    const guardado = await crearRepoPedidos(
      clienteRpc({
        folio_asignado: 1005,
        total_guardado: 14900,
        estado_actual: 'esperando_pago',
        ya_existia: false,
        modo_pago: 'transferencia',
      }),
    ).guardarPedido(pedido, 10);
    expect(guardado).toEqual({
      folio: 1005,
      totalCentavos: 14900,
      estado: 'esperando_pago',
      modoPago: 'transferencia',
      yaExistia: false,
    });
  });

  it('rechaza una fila sin modo de pago (la función SQL de antes de US-22)', async () => {
    const repo = crearRepoPedidos(
      clienteRpc({
        folio_asignado: 1005,
        total_guardado: 14900,
        estado_actual: 'en_cola',
        ya_existia: false,
      }),
    );
    await expect(repo.guardarPedido(pedido, 10)).rejects.toThrow();
  });
});
