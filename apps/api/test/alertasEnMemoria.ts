import type { AlertasRepo, NuevaAlerta } from '../src/services/alerta';

/**
 * Repo de alertas en memoria con las mismas reglas que la función SQL `crear_alerta_atencion`: una
 * alerta por `idChat` (el unique de la tabla) y el folio solo se guarda si está en `pedidos` con ese
 * teléfono; si no, la alerta se guarda sin folio. Prueba la API, no el SQL (ese se prueba a mano).
 * `alertas` queda expuesto para que el test lo revise y `llamadas` cuenta las veces que se usó.
 */
export function crearRepoAlertasEnMemoria(
  pedidos: { folio: number; telefono: string }[] = [],
): AlertasRepo & { alertas: NuevaAlerta[]; llamadas: number } {
  const alertas: NuevaAlerta[] = [];
  const repo = {
    alertas,
    llamadas: 0,
    async crearAlerta(alerta: NuevaAlerta) {
      repo.llamadas += 1;
      if (alertas.some((a) => a.idChat === alerta.idChat)) {
        return { creada: false, folioNoEncontrado: false };
      }
      const folioValido =
        alerta.folio !== null &&
        pedidos.some((p) => p.folio === alerta.folio && p.telefono === alerta.telefono);
      alertas.push({ ...alerta, folio: folioValido ? alerta.folio : null });
      return { creada: true, folioNoEncontrado: alerta.folio !== null && !folioValido };
    },
  };
  return repo;
}

/** Repo que siempre falla, para probar el 500. */
export const repoAlertasQueFalla: AlertasRepo = {
  async crearAlerta() {
    throw new Error('Falló crear_alerta_atencion (código 08006)');
  },
};
