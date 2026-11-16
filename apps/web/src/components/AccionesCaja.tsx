import { METODOS_COBRO_CAJA, type MetodoCobroCaja, type PedidoCaja } from '@serviceagent/shared';
import { Banknote, CreditCard, PackageCheck } from 'lucide-react';
import {
  NOMBRE_METODO_COBRO,
  TEXTO_FALTA_COBRAR,
  muestraEntregar,
  puedeCobrar,
  puedeEntregar,
  type PasoCaja,
} from '../lib/accionesCaja';

const ICONO_METODO: Record<MetodoCobroCaja, typeof Banknote> = {
  efectivo: Banknote,
  tarjeta: CreditCard,
};

const CLASE_BOTON = 'min-h-12 rounded-xl px-4 text-lg font-semibold disabled:opacity-60';
const CLASE_SECUNDARIO = `${CLASE_BOTON} border-2 border-stone-300 bg-white text-stone-800`;

/**
 * Botones de un pedido en caja (US-21, D66). Cobrar abre los métodos (efectivo o tarjeta) con el
 * monto que manda la API; Entregado sale solo en los listos, pide confirmar y no se puede tocar
 * hasta que el pedido esté pagado. Mientras se guarda, todo queda desactivado.
 */
export function AccionesCaja({
  pedido,
  paso,
  error,
  alAbrirCobro,
  alCobrar,
  alPedirEntrega,
  alEntregar,
  alCancelar,
}: {
  pedido: PedidoCaja;
  paso: PasoCaja | null;
  error: string | undefined;
  alAbrirCobro: () => void;
  alCobrar: (metodo: MetodoCobroCaja) => void;
  alPedirEntrega: () => void;
  alEntregar: () => void;
  alCancelar: () => void;
}) {
  const cobrable = puedeCobrar(pedido);
  const conEntrega = muestraEntregar(pedido);
  if (!cobrable && !conEntrega && !paso && !error) return null;
  const guardando = paso?.tipo === 'guardando';

  return (
    <div className="mt-4 space-y-2">
      {paso?.tipo === 'eligiendo_metodo' && (
        <div className="rounded-xl bg-orange-50 p-3">
          <p className="font-semibold text-stone-900">
            Cobrar {pedido.porCobrarTexto} de {pedido.folioTexto} con:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {METODOS_COBRO_CAJA.map((metodo) => {
              const Icono = ICONO_METODO[metodo];
              return (
                <button
                  key={metodo}
                  type="button"
                  onClick={() => alCobrar(metodo)}
                  className={`${CLASE_BOTON} flex flex-1 items-center justify-center gap-2 bg-orange-600 text-white`}
                >
                  <Icono aria-hidden="true" className="size-5" />
                  {NOMBRE_METODO_COBRO[metodo]}
                </button>
              );
            })}
            <button type="button" onClick={alCancelar} className={CLASE_SECUNDARIO}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {paso?.tipo === 'confirmando_entrega' && (
        <div className="rounded-xl bg-green-50 p-3">
          <p className="font-semibold text-stone-900">
            ¿Entregar {pedido.folioTexto} a {pedido.nombreCliente}?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={alEntregar}
              className={`${CLASE_BOTON} flex flex-1 items-center justify-center gap-2 bg-green-600 text-white`}
            >
              <PackageCheck aria-hidden="true" className="size-5" />
              Sí, entregado
            </button>
            <button type="button" onClick={alCancelar} className={CLASE_SECUNDARIO}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {(paso === null || guardando) && (cobrable || conEntrega) && (
        <div className="flex flex-wrap gap-2">
          {cobrable && (
            <button
              type="button"
              disabled={guardando}
              onClick={alAbrirCobro}
              className={`${CLASE_BOTON} flex-1 bg-orange-600 text-white`}
            >
              Cobrar {pedido.porCobrarTexto}
            </button>
          )}
          {conEntrega && (
            <button
              type="button"
              disabled={guardando || !puedeEntregar(pedido)}
              onClick={alPedirEntrega}
              aria-describedby={puedeEntregar(pedido) ? undefined : `falta-cobrar-${pedido.folio}`}
              className={`${CLASE_BOTON} flex flex-1 items-center justify-center gap-2 bg-green-600 text-white`}
            >
              <PackageCheck aria-hidden="true" className="size-5" />
              Entregado
            </button>
          )}
        </div>
      )}

      {conEntrega && !puedeEntregar(pedido) && paso?.tipo !== 'eligiendo_metodo' && (
        <p id={`falta-cobrar-${pedido.folio}`} className="text-sm text-stone-600">
          {TEXTO_FALTA_COBRAR}
        </p>
      )}

      {guardando && (
        <p role="status" className="text-center text-stone-600">
          Guardando…
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-semibold text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
