import {
  botonDe,
  segundosRestantes,
  type AccionCocina,
  type TicketVista,
} from '../lib/accionesCocina';

/**
 * Botones de un ticket de cocina (US-11-P2): Empezar en cola, Terminado verde y grande al preparar
 * y Deshacer con su cuenta regresiva, solo en la tablet que tocó. Mientras se guarda, todo queda
 * desactivado para evitar el doble toque.
 */
export function AccionesTicket({
  vista,
  ahora,
  guardando,
  error,
  alTocar,
}: {
  vista: TicketVista;
  ahora: number;
  guardando: boolean;
  error: string | undefined;
  alTocar: (accion: AccionCocina) => void;
}) {
  const boton = botonDe(vista.estado);
  const segundos = vista.deshacerHasta === null ? 0 : segundosRestantes(vista.deshacerHasta, ahora);

  return (
    <div className="mt-4 space-y-2">
      {boton === 'empezar' && (
        <button
          type="button"
          disabled={guardando}
          onClick={() => alTocar('empezar')}
          className="min-h-14 w-full rounded-xl bg-orange-600 px-4 text-xl font-bold text-white disabled:opacity-60"
        >
          Empezar
        </button>
      )}
      {boton === 'terminar' && (
        <button
          type="button"
          disabled={guardando}
          onClick={() => alTocar('terminar')}
          className="min-h-20 w-full rounded-xl bg-green-600 px-4 text-3xl font-bold text-white disabled:opacity-60"
        >
          Terminado
        </button>
      )}
      {vista.estado === 'listo' && (
        <p className="text-center text-3xl font-bold text-green-800">Terminado</p>
      )}
      {segundos > 0 && (
        <button
          type="button"
          disabled={guardando}
          onClick={() => alTocar('deshacer')}
          className="min-h-12 w-full rounded-xl border-2 border-stone-400 bg-white px-4 text-lg font-semibold text-stone-800 disabled:opacity-60"
        >
          Deshacer ({segundos} s)
        </button>
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
