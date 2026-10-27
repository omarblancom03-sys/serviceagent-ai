import type { AlertasRepo, NuevaAlerta } from '../src/services/alerta';

/**
 * Repo de alertas en memoria con las mismas reglas que la función SQL `crear_alerta_atencion`: una
 * alerta pendiente por `idChat` (el índice único parcial de la tabla); ya atendida, el mismo chat
 * puede crear otra. El folio solo se guarda si está en `pedidos` con ese teléfono; si no, la alerta
 * se guarda sin folio. Prueba la API, no el SQL (ese se prueba a mano). `alertas` queda expuesto
 * para que el test lo revise, `llamadas` cuenta las veces que se usó y `marcarAtendida` hace lo que
 * hará `marcar_alerta_atendida` (su ruta llega en US-18 P1-B).
 */
export function crearRepoAlertasEnMemoria(
  pedidos: { folio: number; telefono: string }[] = [],
): AlertasRepo & {
  alertas: NuevaAlerta[];
  llamadas: number;
  marcarAtendida: (idChat: string) => boolean;
} {
  const alertas: NuevaAlerta[] = [];
  const atendidas = new Set<NuevaAlerta>();
  const pendienteDe = (idChat: string) =>
    alertas.find((a) => a.idChat === idChat && !atendidas.has(a));
  const repo = {
    alertas,
    llamadas: 0,
    async crearAlerta(alerta: NuevaAlerta) {
      repo.llamadas += 1;
      if (pendienteDe(alerta.idChat)) {
        return { creada: false, folioNoEncontrado: false };
      }
      const folioValido =
        alerta.folio !== null &&
        pedidos.some((p) => p.folio === alerta.folio && p.telefono === alerta.telefono);
      alertas.push({ ...alerta, folio: folioValido ? alerta.folio : null });
      return { creada: true, folioNoEncontrado: alerta.folio !== null && !folioValido };
    },
    /** Marca atendida la alerta pendiente de ese chat; `false` si no tenía una. */
    marcarAtendida(idChat: string) {
      const pendiente = pendienteDe(idChat);
      if (!pendiente) return false;
      atendidas.add(pendiente);
      return true;
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
