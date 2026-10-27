import type { AlertasRepo, NuevaAlerta } from '../src/services/alerta';

/** Una fila de `alertas_atencion` en memoria. */
export interface FilaAlertaEnMemoria {
  idAlerta: number;
  alerta: NuevaAlerta;
  creadaEn: Date;
  atendidaEn: Date | null;
  atendidaPor: string | null;
}

/** Reloj por defecto: cada alerta nueva, un minuto después de la anterior. */
function relojPorMinuto() {
  let minuto = 0;
  return () => new Date(Date.UTC(2026, 9, 26, 18, minuto++));
}

/**
 * Repo de alertas en memoria con las mismas reglas que las funciones SQL. `crear_alerta_atencion`:
 * una alerta pendiente por `idChat` (el índice único parcial de la tabla); ya atendida, el mismo
 * chat puede crear otra. El folio solo se guarda si está en `pedidos` con ese teléfono; si no, la
 * alerta se guarda sin folio. `marcar_alerta_atendida`: solo si sigue pendiente; si no,
 * `ya_atendida` o `no_encontrada`. Prueba la API, no el SQL (ese se prueba a mano). `alertas` (lo
 * que se mandó a guardar) y `filas` quedan expuestos para que el test los revise, `llamadas` cuenta
 * las veces que se usó `crearAlerta` y `reloj` da la hora de cada alerta nueva (`creado_en`).
 */
export function crearRepoAlertasEnMemoria(
  pedidos: { folio: number; telefono: string }[] = [],
  reloj: () => Date = relojPorMinuto(),
): AlertasRepo & {
  alertas: NuevaAlerta[];
  filas: FilaAlertaEnMemoria[];
  llamadas: number;
} {
  const alertas: NuevaAlerta[] = [];
  const filas: FilaAlertaEnMemoria[] = [];
  const repo = {
    alertas,
    filas,
    llamadas: 0,
    async crearAlerta(alerta: NuevaAlerta) {
      repo.llamadas += 1;
      if (filas.some((f) => f.alerta.idChat === alerta.idChat && f.atendidaEn === null)) {
        return { creada: false, folioNoEncontrado: false };
      }
      const folioValido =
        alerta.folio !== null &&
        pedidos.some((p) => p.folio === alerta.folio && p.telefono === alerta.telefono);
      const guardada = { ...alerta, folio: folioValido ? alerta.folio : null };
      alertas.push(guardada);
      filas.push({
        idAlerta: filas.length + 1,
        alerta: guardada,
        creadaEn: reloj(),
        atendidaEn: null,
        atendidaPor: null,
      });
      return { creada: true, folioNoEncontrado: alerta.folio !== null && !folioValido };
    },
    async leerPendientes() {
      return filas
        .filter((f) => f.atendidaEn === null)
        .map((f) => ({
          idAlerta: f.idAlerta,
          telefono: f.alerta.telefono,
          nombreCliente: f.alerta.nombreCliente,
          folio: f.alerta.folio,
          motivo: f.alerta.motivo,
          creadaEn: f.creadaEn,
        }));
    },
    async marcarAtendida(idAlerta: number, idEmpleado: string) {
      const fila = filas.find((f) => f.idAlerta === idAlerta);
      if (!fila) return { resultado: 'no_encontrada' as const };
      if (fila.atendidaEn !== null) return { resultado: 'ya_atendida' as const };
      fila.atendidaEn = new Date(fila.creadaEn.getTime() + 5 * 60_000);
      fila.atendidaPor = idEmpleado;
      return { resultado: 'atendida' as const, atendidaEn: fila.atendidaEn };
    },
  };
  return repo;
}

/** Repo que siempre falla, para probar el 500. */
export const repoAlertasQueFalla: AlertasRepo = {
  async crearAlerta() {
    throw new Error('Falló crear_alerta_atencion (código 08006)');
  },
  async leerPendientes() {
    throw new Error('No se pudieron leer las alertas (código 08006)');
  },
  async marcarAtendida() {
    throw new Error('Falló marcar_alerta_atendida (código 08006)');
  },
};
