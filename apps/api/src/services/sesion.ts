import type { EmpleadoPublico, Login } from '@serviceagent/shared';
import { verificarPin } from '../lib/pin';

/** Reglas de bloqueo (docs/negocio.md → Autenticación y roles). */
export const MAX_INTENTOS_PIN = 5;
export const MINUTOS_BLOQUEO = 15;

export interface EmpleadoConPin extends EmpleadoPublico {
  pinHash: string;
  activo: boolean;
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

/** Acceso a datos de empleados. En producción es Supabase; en los tests, memoria. */
export interface EmpleadosRepo {
  listarActivos(): Promise<EmpleadoPublico[]>;
  buscarPorId(id: string): Promise<EmpleadoConPin | null>;
  guardarIntentos(id: string, intentosFallidos: number, bloqueadoHasta: Date | null): Promise<void>;
}

export type ResultadoLogin =
  | { tipo: 'ok'; empleado: EmpleadoPublico }
  | { tipo: 'pin_incorrecto'; intentosRestantes: number }
  | { tipo: 'bloqueado'; minutosRestantes: number };

export function listarEmpleados(repo: EmpleadosRepo): Promise<EmpleadoPublico[]> {
  return repo.listarActivos();
}

/**
 * Valida el PIN de un empleado aplicando el bloqueo temporal:
 * al 5.º intento fallido seguido el empleado queda bloqueado 15 minutos, aunque luego ponga
 * el PIN correcto. Un acceso correcto reinicia el contador.
 */
export async function iniciarSesion(
  repo: EmpleadosRepo,
  { empleadoId, pin }: Login,
  pepper: string,
  ahora: Date = new Date(),
): Promise<ResultadoLogin> {
  const empleado = await repo.buscarPorId(empleadoId);

  // Empleado inexistente o dado de baja: misma respuesta que un PIN incorrecto.
  if (!empleado || !empleado.activo) {
    return { tipo: 'pin_incorrecto', intentosRestantes: MAX_INTENTOS_PIN };
  }

  if (empleado.bloqueadoHasta && empleado.bloqueadoHasta > ahora) {
    return { tipo: 'bloqueado', minutosRestantes: minutosEntre(ahora, empleado.bloqueadoHasta) };
  }

  if (await verificarPin(pin, empleado.pinHash, pepper)) {
    if (empleado.intentosFallidos > 0 || empleado.bloqueadoHasta) {
      await repo.guardarIntentos(empleado.id, 0, null);
    }
    return {
      tipo: 'ok',
      empleado: { id: empleado.id, nombre: empleado.nombre, rol: empleado.rol },
    };
  }

  const intentos = empleado.intentosFallidos + 1;
  if (intentos >= MAX_INTENTOS_PIN) {
    const hasta = new Date(ahora.getTime() + MINUTOS_BLOQUEO * 60_000);
    await repo.guardarIntentos(empleado.id, 0, hasta);
    return { tipo: 'bloqueado', minutosRestantes: MINUTOS_BLOQUEO };
  }

  await repo.guardarIntentos(empleado.id, intentos, null);
  return { tipo: 'pin_incorrecto', intentosRestantes: MAX_INTENTOS_PIN - intentos };
}

function minutosEntre(desde: Date, hasta: Date): number {
  return Math.ceil((hasta.getTime() - desde.getTime()) / 60_000);
}
