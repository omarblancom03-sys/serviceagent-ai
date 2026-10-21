import type { ConfiguracionRestaurante, ModoPago } from '@serviceagent/shared';

/*
 * Configuración del restaurante (US-22): el modo de pago, que decide si el pedido va a cocina al
 * confirmarse o hasta que se pague (D55). Solo la cambia el administrador.
 */

/** La configuración tal como la lee el repo. */
export interface ConfiguracionLeida {
  modoPago: ModoPago;
  actualizadoEn: Date;
  /** Nombre del empleado del último cambio; `null` si nadie lo ha cambiado. */
  actualizadoPor: string | null;
}

/** Interfaz de datos de la configuración. La implementa `lib/repoConfiguracion.ts` (Supabase). */
export interface ConfiguracionRepo {
  leer(): Promise<ConfiguracionLeida>;
  /**
   * Cambia el modo y guarda quién y cuándo, en una transacción (función SQL `cambiar_modo_pago`,
   * D14). Si el modo ya era ese, no cambia nada ni deja historial.
   */
  cambiarModoPago(modoPago: ModoPago, idEmpleado: string): Promise<void>;
}

function aContrato(leida: ConfiguracionLeida): ConfiguracionRestaurante {
  return {
    modoPago: leida.modoPago,
    actualizadoEn: leida.actualizadoEn.toISOString(),
    actualizadoPor: leida.actualizadoPor,
  };
}

/** Los errores del repo se propagan (la ruta responde 500). */
export async function obtenerConfiguracion(
  repo: ConfiguracionRepo,
): Promise<ConfiguracionRestaurante> {
  return aContrato(await repo.leer());
}

/**
 * Cambia el modo de pago a nombre del empleado de la sesión y devuelve la configuración como
 * quedó, con el nombre de quien la cambió. Los pedidos que ya existen no cambian: cada uno guardó
 * su modo al crearse.
 */
export async function cambiarModoPago(
  repo: ConfiguracionRepo,
  modoPago: ModoPago,
  idEmpleado: string,
): Promise<ConfiguracionRestaurante> {
  await repo.cambiarModoPago(modoPago, idEmpleado);
  return aContrato(await repo.leer());
}
