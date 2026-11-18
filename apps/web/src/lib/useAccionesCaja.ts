import {
  RespuestaCobroCajaSchema,
  RespuestaEntregaCajaSchema,
  type MetodoCobroCaja,
  type PedidoCaja,
} from '@serviceagent/shared';
import { useCallback, useState } from 'react';
import {
  abrirCobro,
  cancelarPaso,
  cerrarError,
  crearCandadoCaja,
  estadoAccionesCajaInicial,
  mandarAccionCaja,
  pedirEntrega,
  podarPasos,
  type EstadoAccionesCaja,
} from './accionesCaja';
import type { pedirApi } from './api';

export interface AccionesCajaUso {
  estado: EstadoAccionesCaja;
  /** Toque en Cobrar: muestra los métodos. */
  abrirCobro(folio: number): void;
  /** Toque en Entregado: pide confirmar. */
  pedirEntrega(folio: number): void;
  cancelar(folio: number): void;
  /** Quita el aviso de error de un pedido. */
  cerrarError(folio: number): void;
  /** Con cada lista nueva: borra los pasos que ya no aplican. */
  alLlegarLista(pedidos: readonly PedidoCaja[]): void;
  /** Eligió el método: manda el cobro. */
  cobrar(folio: number, metodo: MetodoCobroCaja): Promise<void>;
  /** Confirmó: manda la entrega. */
  entregar(folio: number): Promise<void>;
}

/**
 * Botones de caja (US-21, D66): llama a la API y guarda en memoria en qué paso va cada pedido.
 * Después de cada respuesta (también si falló) espera a que la lista se vuelva a pedir, para que el
 * pedido salga ya con su pago o en su grupo nuevo y no parpadee con los botones viejos. `recargar`
 * debe ser estable.
 */
export function useAccionesCaja(
  pedirConSesion: typeof pedirApi,
  recargar: () => Promise<void>,
): AccionesCajaUso {
  const [estado, setEstado] = useState<EstadoAccionesCaja>(estadoAccionesCajaInicial);
  const [candado] = useState(crearCandadoCaja);

  const mandar = useCallback(
    (folio: number, pedir: () => Promise<unknown>) =>
      mandarAccionCaja(folio, pedir, recargar, candado, setEstado),
    [candado, recargar],
  );

  const cobrar = useCallback(
    (folio: number, metodo: MetodoCobroCaja) =>
      mandar(folio, () =>
        pedirConSesion(`/caja/pedidos/${folio}/cobrar`, RespuestaCobroCajaSchema, {
          metodo: 'POST',
          cuerpo: { metodo },
        }),
      ),
    [mandar, pedirConSesion],
  );

  const entregar = useCallback(
    (folio: number) =>
      mandar(folio, () =>
        pedirConSesion(`/caja/pedidos/${folio}/entregar`, RespuestaEntregaCajaSchema, {
          metodo: 'POST',
        }),
      ),
    [mandar, pedirConSesion],
  );

  return {
    estado,
    abrirCobro: useCallback((folio) => setEstado((previo) => abrirCobro(previo, folio)), []),
    pedirEntrega: useCallback((folio) => setEstado((previo) => pedirEntrega(previo, folio)), []),
    cancelar: useCallback((folio) => setEstado((previo) => cancelarPaso(previo, folio)), []),
    cerrarError: useCallback((folio) => setEstado((previo) => cerrarError(previo, folio)), []),
    alLlegarLista: useCallback((pedidos) => setEstado((previo) => podarPasos(previo, pedidos)), []),
    cobrar,
    entregar,
  };
}
