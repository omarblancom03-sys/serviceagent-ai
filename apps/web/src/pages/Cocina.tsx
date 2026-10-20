import { RespuestaPedidosCocinaSchema, type TicketCocina } from '@serviceagent/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSesion } from '../auth/SesionContext';
import {
  DURACION_RESALTE_MS,
  ETIQUETA_ESTADO,
  INTERVALO_REFRESCO_MS,
  TEXTO_CONEXION,
  ZONA_HORARIA_RESTAURANTE,
  crearRecargador,
  foliosNuevos,
  mensajeErrorCocina,
  separarRenglones,
  type EstadoConexion,
  type LineaTicket,
  type Recargador,
} from '../lib/cocina';
import { formatearHora } from '../lib/menuAdmin';
import { escucharSenalPedidos, hayRealtime } from '../lib/senalPedidos';

/**
 * Pantalla de cocina (US-10). Los pedidos aparecen solos: la señal de Realtime avisa que algo
 * cambió y la lista se vuelve a pedir a la API con la sesión (D12, D47). Si la señal se pierde, la
 * lista se refresca cada 30 s. Los botones Empezar y Terminado llegan con US-11.
 */
export function Cocina() {
  const { pedirConSesion } = useSesion();
  const [tickets, setTickets] = useState<TicketCocina[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conexion, setConexion] = useState<EstadoConexion>(() =>
    hayRealtime() ? 'conectando' : 'sin_tiempo_real',
  );
  const [resaltados, setResaltados] = useState<ReadonlySet<number>>(new Set());
  const [aviso, setAviso] = useState('');

  const anteriores = useRef<TicketCocina[] | null>(null);
  const recargador = useRef<Recargador | null>(null);
  const temporizadores = useRef(new Set<ReturnType<typeof setTimeout>>());

  const despues = useCallback((ms: number, accion: () => void) => {
    const id = setTimeout(() => {
      temporizadores.current.delete(id);
      accion();
    }, ms);
    temporizadores.current.add(id);
    return id;
  }, []);

  const cargarUnaVez = useCallback(async () => {
    try {
      const { pedidos } = await pedirConSesion('/cocina/pedidos', RespuestaPedidosCocinaSchema);
      const nuevos = foliosNuevos(anteriores.current, pedidos);
      anteriores.current = pedidos;
      setTickets(pedidos);
      setError(null);
      if (nuevos.length > 0) {
        setAviso(`Llegó el pedido ${nuevos.map((f) => `#${f}`).join(', ')}`);
        setResaltados((previos) => new Set([...previos, ...nuevos]));
        despues(DURACION_RESALTE_MS, () =>
          setResaltados((previos) => new Set([...previos].filter((f) => !nuevos.includes(f)))),
        );
      }
    } catch (causa) {
      setError(mensajeErrorCocina(causa));
    }
  }, [pedirConSesion, despues]);

  useEffect(() => {
    // Cuándo pedir la lista (agrupar señales, una petición a la vez, ponerse al día): lib/cocina.ts.
    const recarga = crearRecargador(cargarUnaVez);
    recargador.current = recarga;
    void recarga.recargar();
    const refresco = setInterval(() => void recarga.recargar(), INTERVALO_REFRESCO_MS);

    const dejarDeEscuchar = escucharSenalPedidos(
      () => recarga.senal(),
      (estado) => {
        setConexion(estado);
        recarga.conexion(estado);
      },
    );

    const pendientes = temporizadores.current;
    return () => {
      clearInterval(refresco);
      recarga.detener();
      recargador.current = null;
      pendientes.forEach(clearTimeout);
      pendientes.clear();
      dejarDeEscuchar?.();
    };
  }, [cargarUnaVez]);

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-orange-800">Cocina</h1>
        {tickets && (
          <span className="text-lg text-stone-600">
            {tickets.length === 1 ? '1 pedido' : `${tickets.length} pedidos`}
          </span>
        )}
        <IndicadorConexion estado={conexion} />
      </div>

      <p className="sr-only" aria-live="polite">
        {aviso}
      </p>

      {error && (
        <div role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-800">
          {error}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void recargador.current?.recargar()}
          >
            Reintentar ahora
          </button>
        </div>
      )}

      {tickets === null && !error && <p className="mt-8 text-stone-500">Cargando pedidos…</p>}

      {tickets?.length === 0 && (
        <p className="mt-12 text-center text-xl text-stone-500">No hay pedidos por preparar.</p>
      )}

      {tickets && tickets.length > 0 && (
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tickets.map((ticket) => (
            <Ticket key={ticket.folio} ticket={ticket} nuevo={resaltados.has(ticket.folio)} />
          ))}
        </ol>
      )}
    </section>
  );
}

function IndicadorConexion({ estado }: { estado: EstadoConexion }) {
  const color = estado === 'en_vivo' ? 'bg-green-500' : 'bg-amber-500';
  return (
    <span className="ml-auto flex items-center gap-2 text-sm text-stone-600">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
      {TEXTO_CONEXION[estado]}
    </span>
  );
}

function Ticket({ ticket, nuevo }: { ticket: TicketCocina; nuevo: boolean }) {
  const { platillos, aparte } = separarRenglones(ticket);
  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        nuevo ? 'border-orange-400 ring-4 ring-orange-300' : 'border-orange-200'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-bold text-stone-900">{ticket.folioTexto}</span>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            ticket.estado === 'preparando'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-orange-100 text-orange-800'
          }`}
        >
          {nuevo ? 'Nuevo' : ETIQUETA_ESTADO[ticket.estado]}
        </span>
      </div>
      <p className="mt-1 text-stone-600">
        {ticket.nombreCliente} · entró a las{' '}
        {formatearHora(ticket.enColaDesde, ZONA_HORARIA_RESTAURANTE)}
      </p>

      <Lineas lineas={platillos} />
      {aparte.length > 0 && (
        <>
          <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Aparte
          </p>
          <Lineas lineas={aparte} />
        </>
      )}
    </li>
  );
}

function Lineas({ lineas }: { lineas: LineaTicket[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {lineas.map((linea, i) => (
        <li key={i}>
          <p className="text-xl font-semibold text-stone-900">{linea.principal}</p>
          {linea.detalles.map((detalle) => (
            <p key={detalle} className="ml-6 text-lg text-orange-800">
              {detalle}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
