import { z } from 'zod';
import { CANTIDAD_MAXIMA, CANTIDAD_MINIMA } from './pedido';

/*
 * Contrato de la pantalla de cocina (US-10): `GET /cocina/pedidos`. Lleva solo lo que cocina
 * necesita para preparar: sin precios, totales ni teléfono.
 */

/** Estados que se ven en cocina: los que esperan y los que se están preparando. */
export const ESTADOS_COCINA = ['en_cola', 'preparando'] as const;
export const EstadoCocinaSchema = z.enum(ESTADOS_COCINA);

const CantidadSchema = z.number().int().min(CANTIDAD_MINIMA).max(CANTIDAD_MAXIMA);

export const ExtraCocinaSchema = z.object({
  nombre: z.string(),
  /** Por unidad del platillo, igual que en el pedido. */
  cantidad: CantidadSchema,
});

export const RenglonCocinaSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('platillo'),
    cantidad: CantidadSchema,
    nombre: z.string(),
    /** null si el platillo solo tiene la variante "Único". */
    variante: z.string().nullable(),
    /** Ingredientes que el cliente pidió quitar, con su nombre oficial. */
    sinIngredientes: z.array(z.string()),
    extras: z.array(ExtraCocinaSchema),
  }),
  z.object({
    tipo: z.literal('extra'),
    cantidad: CantidadSchema,
    nombre: z.string(),
  }),
]);

export const TicketCocinaSchema = z.object({
  folio: z.number().int().positive(),
  /** Para mostrarlo tal cual: "#1001". */
  folioTexto: z.string(),
  nombreCliente: z.string(),
  estado: EstadoCocinaSchema,
  /** Hora en que el pedido entró a la cola (historial, D42). Ordena los tickets. */
  enColaDesde: z.iso.datetime({ offset: true }),
  /** En el orden en que se pidió: platillos primero y luego extras sueltos. */
  renglones: z.array(RenglonCocinaSchema).min(1),
});

/** Del más antiguo al más nuevo según `enColaDesde`: el primero es el que lleva más esperando. */
export const RespuestaPedidosCocinaSchema = z.object({
  pedidos: z.array(TicketCocinaSchema),
});

export const ErrorCocinaSchema = z.object({ error: z.string() });

/**
 * Señal de Realtime (D12): el canal y el evento que avisan "cambió un pedido". No trae datos; la
 * pantalla vuelve a pedir `GET /cocina/pedidos` con su sesión. Los manda un trigger de la base.
 */
export const CANAL_SENAL_PEDIDOS = 'pedidos';
export const EVENTO_SENAL_PEDIDOS = 'cambio';

export type EstadoCocina = z.infer<typeof EstadoCocinaSchema>;
export type ExtraCocina = z.infer<typeof ExtraCocinaSchema>;
export type RenglonCocina = z.infer<typeof RenglonCocinaSchema>;
export type TicketCocina = z.infer<typeof TicketCocinaSchema>;
export type RespuestaPedidosCocina = z.infer<typeof RespuestaPedidosCocinaSchema>;
export type ErrorCocina = z.infer<typeof ErrorCocinaSchema>;
