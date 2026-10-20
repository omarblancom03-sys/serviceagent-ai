import type { EstadoCocina, RenglonCocina, TicketCocina } from '@serviceagent/shared';

/*
 * Pantalla de cocina (US-10). Recibe los pedidos activos ya leídos de la base y arma los tickets:
 * solo lo que cocina necesita para preparar (sin precios ni teléfono), del más antiguo al más
 * nuevo según la hora en que entraron a la cola.
 */

/** Un pedido activo tal como lo lee el repo, antes de ordenarlo. */
export interface PedidoActivo {
  folio: number;
  nombreCliente: string;
  estado: EstadoCocina;
  /** Hora en que entró a 'en_cola' (historial, D42). */
  enColaDesde: Date;
  /** En el orden en que se pidió (`posicion`). */
  renglones: RenglonCocina[];
}

/** Interfaz de datos de cocina. La implementa `lib/repoCocina.ts` (Supabase) o un repo en memoria. */
export interface CocinaRepo {
  /** Pedidos en 'en_cola' o 'preparando', con sus renglones y extras. */
  leerPedidosActivos(): Promise<PedidoActivo[]>;
}

/**
 * Tickets del más antiguo al más nuevo. Si dos entraron a la cola en el mismo instante, va primero
 * el folio menor, que se creó antes (D33).
 */
export function armarTickets(pedidos: PedidoActivo[]): TicketCocina[] {
  return [...pedidos]
    .sort((a, b) => a.enColaDesde.getTime() - b.enColaDesde.getTime() || a.folio - b.folio)
    .map((p) => ({
      folio: p.folio,
      folioTexto: `#${p.folio}`,
      nombreCliente: p.nombreCliente,
      estado: p.estado,
      enColaDesde: p.enColaDesde.toISOString(),
      renglones: p.renglones,
    }));
}

/** Lee los pedidos activos y arma los tickets. Los errores del repo se propagan (la ruta da 500). */
export async function obtenerPedidosCocina(repo: CocinaRepo): Promise<TicketCocina[]> {
  return armarTickets(await repo.leerPedidosActivos());
}
