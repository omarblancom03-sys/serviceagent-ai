import { z } from 'zod';

/*
 * Configuración del restaurante (US-22): el modo de pago, que también decide cuándo va el pedido a
 * cocina (D55) y qué métodos ofrece el agente (US-23, D76). La lee y la cambia solo el administrador: `GET` y `PATCH /admin/configuracion`.
 */

/**
 * - `al_recoger`: se paga en caja al recoger (efectivo o tarjeta); el pedido va a cocina al
 *   confirmarse (`al_confirmar`, D46). Es el modo inicial.
 * - `transferencia`: se paga antes por transferencia; el pedido espera el pago antes de ir a
 *   cocina (`al_pagar`, US-25).
 */
export const MODOS_PAGO = ['al_recoger', 'transferencia'] as const;
export const ModoPagoSchema = z.enum(MODOS_PAGO);

/** Métodos de pago (docs/negocio.md → Pagos): efectivo y tarjeta en caja, transferencia por el agente. */
export const METODOS_PAGO = ['efectivo', 'tarjeta', 'transferencia'] as const;
export const MetodoPagoSchema = z.enum(METODOS_PAGO);

/**
 * Métodos que el agente ofrece según el modo de pago del restaurante (US-23, D76): con pago al
 * recoger, efectivo o tarjeta en caja; con transferencia, solo transferencia.
 */
export const METODOS_POR_MODO = {
  al_recoger: ['efectivo', 'tarjeta'],
  transferencia: ['transferencia'],
} as const satisfies Record<(typeof MODOS_PAGO)[number], readonly (typeof METODOS_PAGO)[number][]>;

export const ConfiguracionRestauranteSchema = z.object({
  modoPago: ModoPagoSchema,
  /** Hora del último cambio (o de cuando se creó la configuración). */
  actualizadoEn: z.iso.datetime({ offset: true }),
  /** Nombre del empleado que hizo el último cambio; `null` si nadie lo ha cambiado. */
  actualizadoPor: z.string().nullable(),
});

/** Cuerpo de `PATCH /admin/configuracion`. Estricto: una llave desconocida da 400. */
export const CambiarConfiguracionPeticionSchema = z.strictObject({
  modoPago: ModoPagoSchema,
});

export const ErrorConfiguracionSchema = z.object({ error: z.string() });

export type ModoPago = z.infer<typeof ModoPagoSchema>;
export type MetodoPago = z.infer<typeof MetodoPagoSchema>;
export type ConfiguracionRestaurante = z.infer<typeof ConfiguracionRestauranteSchema>;
export type CambiarConfiguracionPeticion = z.infer<typeof CambiarConfiguracionPeticionSchema>;
export type ErrorConfiguracion = z.infer<typeof ErrorConfiguracionSchema>;
