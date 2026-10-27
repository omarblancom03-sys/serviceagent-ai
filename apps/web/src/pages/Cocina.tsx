import { RespuestaPedidosCocinaSchema, type TicketCocina } from '@serviceagent/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSesion } from '../auth/SesionContext';
import { AccionesTicket } from '../components/AccionesTicket';
import { IndicadorConexion } from '../components/IndicadorConexion';
import type { EstadoVista } from '../lib/accionesCocina';
import {
  DURACION_RESALTE_MS,
  ETIQUETA_ESTADO,
  INTERVALO_REFRESCO_MS,
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
import {
  INTERVALO_RELOJ_MS,
  clasesTicket,
  estaAtrasado,
  minutosDesde,
  textoTiempo,
} from '../lib/tiempoCocina';
import { useAccionesCocina } from '../lib/useAccionesCocina';
import { useAhora } from '../lib/useAhora';

/**
 * Pantalla de cocina (US-10). Los pedidos aparecen solos: la señal de Realtime avisa que algo
 * cambió y la lista se vuelve a pedir a la API con la sesión (D12, D47). Si la señal se pierde, la
 * lista se refresca cada 30 s. Empezar, Terminado y Deshacer (US-11): lib/accionesCocina.ts.
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
  const ahora = useAhora(INTERVALO_RELOJ_MS);

  const anteriores = useRef<TicketCocina[] | null>(null);
  const recargador = useRef<Recargador | null>(null);
  const temporizadores = useRef(new Set<ReturnType<typeof setTimeout>>());
  const recargarLista = useCallback(() => void recargador.current?.recargar(), []);
  const acciones = useAccionesCocina(pedirConSesion, recargarLista);
  const { nuevaLista, listaRecibida } = acciones;

  const despues = useCallback((ms: number, accion: () => void) => {
    const id = setTimeout(() => {
      temporizadores.current.delete(id);
      accion();
    }, ms);
    temporizadores.current.add(id);
    return id;
  }, []);

  const cargarUnaVez = useCallback(async () => {
    const numero = nuevaLista();
    try {
      const { pedidos } = await pedirConSesion('/cocina/pedidos', RespuestaPedidosCocinaSchema);
      const nuevos = foliosNuevos(anteriores.current, pedidos);
      anteriores.current = pedidos;
      setTickets(pedidos);
      listaRecibida(numero);
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
  }, [pedirConSesion, despues, nuevaLista, listaRecibida]);

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

  const vistas = tickets && acciones.vistas(tickets);

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

      {vistas?.length === 0 && (
        <p className="mt-12 text-center text-xl text-stone-500">No hay pedidos por preparar.</p>
      )}

      {vistas && vistas.length > 0 && (
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vistas.map((vista) => (
            <Ticket
              key={vista.ticket.folio}
              ticket={vista.ticket}
              estado={vista.estado}
              nuevo={resaltados.has(vista.ticket.folio) && vista.estado === 'en_cola'}
              ahora={ahora}
            >
              <AccionesTicket
                vista={vista}
                ahora={acciones.ahora}
                guardando={acciones.guardando.has(vista.ticket.folio)}
                error={acciones.errores.get(vista.ticket.folio)}
                alTocar={(accion) => void acciones.tocar(vista, accion)}
              />
            </Ticket>
          ))}
        </ol>
      )}
    </section>
  );
}

function Ticket({
  ticket,
  estado,
  nuevo,
  ahora,
  children,
}: {
  ticket: TicketCocina;
  estado: EstadoVista;
  nuevo: boolean;
  ahora: number;
  children: ReactNode;
}) {
  const { platillos, aparte } = separarRenglones(ticket);
  const minutos = minutosDesde(ticket.enColaDesde, ahora);
  const atrasado = estaAtrasado(minutos);
  const terminado = estado === 'listo';
  return (
    <li className={clasesTicket({ nuevo, atrasado, terminado })}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-bold text-stone-900">{ticket.folioTexto}</span>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            terminado
              ? 'bg-green-100 text-green-800'
              : estado === 'preparando'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-orange-100 text-orange-800'
          }`}
        >
          {nuevo ? 'Nuevo' : terminado ? 'Terminado' : ETIQUETA_ESTADO[estado]}
        </span>
      </div>
      <p className="mt-1 text-stone-600">
        {ticket.nombreCliente} · entró a las{' '}
        {formatearHora(ticket.enColaDesde, ZONA_HORARIA_RESTAURANTE)}
      </p>
      <p className="mt-2 flex items-center gap-2">
        <span className={`text-2xl font-bold ${atrasado ? 'text-red-700' : 'text-stone-900'}`}>
          {textoTiempo(minutos)}
        </span>
        {atrasado && (
          <span className="rounded-full bg-red-600 px-3 py-1 text-sm font-semibold text-white">
            Atrasado
          </span>
        )}
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
      {children}
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
