import { z } from 'zod';
import { IdSchema } from './menu';
import { CANTIDAD_MAXIMA, CANTIDAD_MINIMA, EstadoPedidoSchema } from './pedido';

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

/*
 * Cambio de estado en cocina (US-11-P1, D56): `POST /cocina/pedidos/{folio}/empezar`,
 * `/terminar` y `/deshacer`. Quién lo hizo sale de la sesión, nunca del cuerpo.
 */

/** Segundos que la pantalla muestra el botón Deshacer después de Empezar o Terminado. */
export const SEGUNDOS_DESHACER_PANTALLA = 10;
/** Plazo que revisa la base al deshacer: un poco más que la pantalla, por la latencia de la red. */
export const SEGUNDOS_DESHACER_SERVIDOR = 15;

/** Folio en la ruta: solo dígitos (nada de `1e3` ni `0x10`), convertido a número. */
export const ParamsFolioCocinaSchema = z.object({
  folio: z
    .string()
    .regex(/^\d{1,10}$/, 'El folio debe ser un entero positivo')
    .transform(Number)
    .pipe(IdSchema),
});

/** Estados que se pueden deshacer: Empezar deja `preparando` y Terminado deja `listo`. */
export const ESTADOS_DESHACER = ['preparando', 'listo'] as const;
export const EstadoDeshacerSchema = z.enum(ESTADOS_DESHACER);

/** Cuerpo de `/deshacer`: el estado que se quiere deshacer. */
export const DeshacerCambioCocinaPeticionSchema = z.strictObject({ estado: EstadoDeshacerSchema });

/** Respuesta de `/empezar` y `/terminar`. */
export const RespuestaCambioEstadoCocinaSchema = z.object({
  folio: z.number().int().positive(),
  folioTexto: z.string(),
  /** Empezar deja `preparando` y Terminado deja `listo`. */
  estado: EstadoDeshacerSchema,
  /** Hora del cambio, puesta por Postgres (D42). */
  cambiadoEn: z.iso.datetime({ offset: true }),
  /** `cambiadoEn` + `SEGUNDOS_DESHACER_PANTALLA`: hasta cuándo la pantalla ofrece Deshacer. */
  deshacerHasta: z.iso.datetime({ offset: true }),
});

/** Respuesta de `/deshacer`: el estado al que regresó el pedido. */
export const RespuestaDeshacerCocinaSchema = z.object({
  folio: z.number().int().positive(),
  folioTexto: z.string(),
  estado: EstadoCocinaSchema,
});

/**
 * Motivos del 409: el pedido ya no está en el estado esperado (otra tablet lo cambió, o lo que se
 * quiere deshacer no fue el último cambio) o ya pasó el plazo para deshacer.
 */
export const CODIGOS_CONFLICTO_COCINA = ['estado_cambio', 'plazo_vencido'] as const;

export const ConflictoCocinaSchema = z.object({
  error: z.string(),
  codigo: z.enum(CODIGOS_CONFLICTO_COCINA),
  /** Estado en que está el pedido ahora, para que la pantalla se acomode. */
  estadoActual: EstadoPedidoSchema,
});

export type EstadoCocina = z.infer<typeof EstadoCocinaSchema>;
export type ExtraCocina = z.infer<typeof ExtraCocinaSchema>;
export type RenglonCocina = z.infer<typeof RenglonCocinaSchema>;
export type TicketCocina = z.infer<typeof TicketCocinaSchema>;
export type RespuestaPedidosCocina = z.infer<typeof RespuestaPedidosCocinaSchema>;
export type ErrorCocina = z.infer<typeof ErrorCocinaSchema>;
export type ParamsFolioCocina = z.infer<typeof ParamsFolioCocinaSchema>;
export type EstadoDeshacer = z.infer<typeof EstadoDeshacerSchema>;
export type DeshacerCambioCocinaPeticion = z.infer<typeof DeshacerCambioCocinaPeticionSchema>;
export type RespuestaCambioEstadoCocina = z.infer<typeof RespuestaCambioEstadoCocinaSchema>;
export type RespuestaDeshacerCocina = z.infer<typeof RespuestaDeshacerCocinaSchema>;
export type CodigoConflictoCocina = (typeof CODIGOS_CONFLICTO_COCINA)[number];
export type ConflictoCocina = z.infer<typeof ConflictoCocinaSchema>;
