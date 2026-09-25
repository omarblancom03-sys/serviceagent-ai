import type { Rol } from '@serviceagent/shared';
import { hashPin } from '../src/lib/pin';
import type { EmpleadoConPin, EmpleadosRepo } from '../src/services/sesion';

/** Pocas iteraciones: en los tests importa el comportamiento, no el costo del hash. */
const ITERACIONES_TEST = 1_000;

export const PEPPER_TEST = 'pepper-de-prueba-con-al-menos-32-caracteres';

export const IDS = {
  cocina: '0f8d7a5e-3c1b-4e2a-9d6f-1a2b3c4d5e01',
  caja: '0f8d7a5e-3c1b-4e2a-9d6f-1a2b3c4d5e02',
  admin: '0f8d7a5e-3c1b-4e2a-9d6f-1a2b3c4d5e03',
  inactivo: '0f8d7a5e-3c1b-4e2a-9d6f-1a2b3c4d5e04',
} as const;

async function empleado(id: string, nombre: string, rol: Rol, pin: string, activo = true) {
  return {
    id,
    nombre,
    rol,
    pinHash: await hashPin(pin, PEPPER_TEST, ITERACIONES_TEST),
    activo,
    intentosFallidos: 0,
    bloqueadoHasta: null,
  } satisfies EmpleadoConPin;
}

/** Repo en memoria con un empleado por rol (PIN 1111, 2222, 3333) y uno inactivo (4444). */
export async function crearRepoEnMemoria() {
  const empleados = new Map<string, EmpleadoConPin>(
    (
      await Promise.all([
        empleado(IDS.cocina, 'Cocina de prueba', 'cocina', '1111'),
        empleado(IDS.caja, 'Caja de prueba', 'caja', '2222'),
        empleado(IDS.admin, 'Admin de prueba', 'admin', '3333'),
        empleado(IDS.inactivo, 'Ex empleado', 'caja', '4444', false),
      ])
    ).map((e) => [e.id, e]),
  );

  const repo: EmpleadosRepo = {
    async listarActivos() {
      return [...empleados.values()]
        .filter((e) => e.activo)
        .map(({ id, nombre, rol }) => ({ id, nombre, rol }));
    },
    async buscarPorId(id) {
      const encontrado = empleados.get(id);
      return encontrado ? { ...encontrado } : null;
    },
    async guardarIntentos(id, intentosFallidos, bloqueadoHasta) {
      const encontrado = empleados.get(id);
      if (encontrado) empleados.set(id, { ...encontrado, intentosFallidos, bloqueadoHasta });
    },
  };

  return { repo, empleados };
}
