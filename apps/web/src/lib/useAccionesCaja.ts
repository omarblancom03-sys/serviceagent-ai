import {
  RespuestaCobroCajaSchema,
  RespuestaEntregaCajaSchema,
  type MetodoCobroCaja,
} from '@serviceagent/shared';
import { useCallback, useState } from 'react';
import {
  abrirCobro,
  cancelarPaso,
  crearCandadoCaja,
  empezarGuardado,
  estadoAccionesCajaInicial,
  mensajeErrorAccionCaja,
  pedirEntrega,
  terminarGuardado,
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
    async (folio: number, pedir: () => Promise<unknown>) => {
      if (!candado.tomar(folio)) return;
      setEstado((previo) => empezarGuardado(previo, folio));
      let error: string | null = null;
      try {
        await pedir();
      } catch (causa) {
        error = mensajeErrorAccionCaja(causa);
      }
      try {
        await recargar();
      } finally {
        candado.soltar(folio);
        setEstado((previo) => terminarGuardado(previo, folio, error));
      }
    },
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
    cobrar,
    entregar,
  };
}
