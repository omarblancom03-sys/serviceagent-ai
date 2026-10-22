import type { ModoPago } from '@serviceagent/shared';
import type { ConfiguracionRepo } from '../src/services/configuracion';

/** Repo en memoria con las reglas de `cambiar_modo_pago`: si el modo no cambia, no hay historial. */
export function crearRepoConfiguracionEnMemoria(nombres: Record<string, string> = {}) {
  const repo = {
    modoPago: 'al_recoger' as ModoPago,
    actualizadoEn: new Date('2026-10-21T06:00:00Z'),
    idEmpleado: null as string | null,
    historial: [] as { modoPago: string; idEmpleado: string }[],
    ahora: new Date('2026-10-21T18:00:00Z'),
    leer: () =>
      Promise.resolve({
        modoPago: repo.modoPago,
        actualizadoEn: repo.actualizadoEn,
        actualizadoPor: repo.idEmpleado ? (nombres[repo.idEmpleado] ?? null) : null,
      }),
    cambiarModoPago: (modoPago: ModoPago, idEmpleado: string) => {
      if (modoPago !== repo.modoPago) {
        repo.modoPago = modoPago;
        repo.idEmpleado = idEmpleado;
        repo.actualizadoEn = repo.ahora;
        repo.historial.push({ modoPago, idEmpleado });
      }
      return Promise.resolve();
    },
  };
  return repo satisfies ConfiguracionRepo;
}
