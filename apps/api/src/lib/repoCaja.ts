import { EstadoPedidoSchema, MetodoPagoSchema } from '@serviceagent/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ESTADOS_ABIERTOS, type CajaRepo, type PedidoCajaLeido } from '../services/caja';

/*
 * Pedidos de caja con su historial y sus pagos, en una sola consulta de PostgREST
 * (supabase/migrations/*_crear_pedidos.sql y *_crear_pagos.sql). Se validan con zod al leerlas.
 */
const FilaPedidoSchema = z.object({
  folio: z.number().int(),
  nombre_cliente: z.string(),
  telefono: z.string(),
  estado: EstadoPedidoSchema,
  total_centavos: z.number().int(),
  creado_en: z.string(),
  historial_estado_pedido: z.array(z.object({ estado: EstadoPedidoSchema, creado_en: z.string() })),
  pagos: z.array(
    z.object({ metodo: MetodoPagoSchema, monto_centavos: z.number().int(), creado_en: z.string() }),
  ),
});

const COLUMNAS =
  'folio, nombre_cliente, telefono, estado, total_centavos, creado_en, ' +
  'historial_estado_pedido(estado, creado_en), pagos(metodo, monto_centavos, creado_en)';

/** Implementación de `CajaRepo` sobre Supabase. */
export function crearRepoCaja(cliente: SupabaseClient): CajaRepo {
  return {
    async leerPedidosCaja(desde: Date): Promise<PedidoCajaLeido[]> {
      // Creados desde el inicio del día, o de antes pero todavía abiertos. La hora va entre
      // comillas para que PostgREST no confunda sus puntos con los del filtro.
      const filtro =
        `creado_en.gte."${desde.toISOString()}",` + `estado.in.(${ESTADOS_ABIERTOS.join(',')})`;
      const { data, error } = await cliente.from('pedidos').select(COLUMNAS).or(filtro);
      if (error) throw new Error(`No se pudieron leer los pedidos de caja: ${error.message}`);

      return z
        .array(FilaPedidoSchema)
        .parse(data)
        .map((fila) => ({
          folio: fila.folio,
          nombreCliente: fila.nombre_cliente,
          telefono: fila.telefono,
          estado: fila.estado,
          totalCentavos: fila.total_centavos,
          creadoEn: new Date(fila.creado_en),
          historial: fila.historial_estado_pedido.map((h) => ({
            estado: h.estado,
            creadoEn: new Date(h.creado_en),
          })),
          pagos: fila.pagos.map((p) => ({
            metodo: p.metodo,
            montoCentavos: p.monto_centavos,
            creadoEn: new Date(p.creado_en),
          })),
        }));
    },
  };
}
