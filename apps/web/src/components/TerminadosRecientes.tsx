import type { TicketTerminadoCocina } from '@serviceagent/shared';
import { Undo2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { erroresSinTicket, type ErrorTicket } from '../lib/accionesCocina';
import { separarRenglones, type LineaTicket } from '../lib/cocina';
import {
  proximoVencimientoTerminado,
  terminadosVigentes,
  textoHace,
} from '../lib/terminadosCocina';

/**
 * Sección gris "Terminados recientes" de cocina (US-52-P2, D63), debajo de la cuadrícula: lo
 * terminado en los últimos 15 min, del más reciente al más viejo y hasta 20, con **Regresar** (sin
 * confirmación ni Deshacer). Cada ticket sale justo al cumplir 15 min con el reloj de la tablet, sin
 * esperar la recarga. Arriba, los errores cuyo ticket ya no está, con Cerrar. Si no hay nada que
 * mostrar, no se pinta.
 */
export function TerminadosRecientes({
  terminados,
  ahora,
  enCuadricula,
  guardando,
  errores,
  alRegresar,
  alCerrarError,
}: {
  /** De la API con los cambios de esta tablet encima, sin el corte de 15 min. */
  terminados: readonly TicketTerminadoCocina[];
  /** Reloj de la pantalla (US-13, cada 15 s). */
  ahora: number;
  /** Folios que están en la cuadrícula: sus errores se ven en su ticket. */
  enCuadricula: ReadonlySet<number>;
  guardando: ReadonlySet<number>;
  errores: ReadonlyMap<number, ErrorTicket>;
  alRegresar: (terminado: TicketTerminadoCocina) => void;
  alCerrarError: (folio: number) => void;
}) {
  // El reloj de la pantalla avanza cada 15 s; este despierta justo cuando sale el siguiente.
  const [vencimiento, setVencimiento] = useState(() => Date.now());
  const momento = Math.max(ahora, vencimiento);
  const visibles = terminadosVigentes(terminados, momento);
  const proximo = proximoVencimientoTerminado(terminados, momento);

  useEffect(() => {
    if (proximo === null) return;
    const id = setTimeout(() => setVencimiento(Date.now()), Math.max(0, proximo - Date.now()));
    return () => clearTimeout(id);
  }, [proximo]);

  const enPantalla = new Set([...enCuadricula, ...visibles.map((t) => t.folio)]);
  const avisos = erroresSinTicket(errores, enPantalla);
  if (visibles.length === 0 && avisos.length === 0) return null;

  return (
    <section aria-labelledby="terminados-recientes" className="mt-10">
      {avisos.map((aviso) => (
        <div
          key={aviso.folio}
          role="alert"
          className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-red-50 p-3 font-semibold text-red-800"
        >
          <span>{aviso.texto}</span>
          <button
            type="button"
            onClick={() => alCerrarError(aviso.folio)}
            className="flex min-h-12 items-center gap-1 rounded-xl border border-red-300 bg-white px-3 text-red-800"
          >
            <X aria-hidden className="size-5" />
            Cerrar
          </button>
        </div>
      ))}

      {visibles.length > 0 && (
        <div className="rounded-2xl bg-stone-100 p-4">
          <h2 id="terminados-recientes" className="text-2xl font-bold text-stone-600">
            Terminados recientes
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.map((terminado) => (
              <TerminadoReciente
                key={terminado.folio}
                terminado={terminado}
                ahora={momento}
                guardando={guardando.has(terminado.folio)}
                error={errores.get(terminado.folio)?.texto}
                alRegresar={() => alRegresar(terminado)}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function TerminadoReciente({
  terminado,
  ahora,
  guardando,
  error,
  alRegresar,
}: {
  terminado: TicketTerminadoCocina;
  ahora: number;
  guardando: boolean;
  error: string | undefined;
  alRegresar: () => void;
}) {
  const { platillos, aparte } = separarRenglones(terminado);
  return (
    <li className="rounded-2xl border border-stone-300 bg-stone-50 p-3 text-stone-600">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold text-stone-700">{terminado.folioTexto}</span>
        <span className="text-sm">{textoHace(terminado.terminadoEn, ahora)}</span>
      </div>
      <p className="text-stone-600">{terminado.nombreCliente}</p>
      <LineasChicas lineas={[...platillos, ...aparte]} />
      <div className="mt-3 space-y-2">
        <button
          type="button"
          disabled={guardando}
          onClick={alRegresar}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-stone-400 bg-white px-4 text-lg font-semibold text-stone-800 disabled:opacity-60"
        >
          <Undo2 aria-hidden className="size-5" />
          Regresar
        </button>
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
    </li>
  );
}

function LineasChicas({ lineas }: { lineas: LineaTicket[] }) {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {lineas.map((linea, i) => (
        <li key={i}>
          <p>{linea.principal}</p>
          {linea.detalles.map((detalle) => (
            <p key={detalle} className="ml-4 text-xs">
              {detalle}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
