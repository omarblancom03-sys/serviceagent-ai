import {
  RespuestaPedidosCocinaSchema,
  type RespuestaPedidosCocina,
  type TicketCocina,
} from '@serviceagent/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSesion } from '../auth/SesionContext';
import { AccionesTicket } from '../components/AccionesTicket';
import { IndicadorConexion } from '../components/IndicadorConexion';
import { TerminadosRecientes } from '../components/TerminadosRecientes';
import {
  AVISO_SONIDO,
  contarPedidos,
  crearAvisoSonoro,
  textoBotonSonido,
  textoContador,
  type AvisoSonoro,
  type EstadoSonido,
} from '../lib/avisoCocina';
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
import { crearSonadorWebAudio, hayWebAudio } from '../lib/sonidoCocina';
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
 * lista se refresca cada 30 s. Empezar, Terminado y Deshacer (US-11): lib/accionesCocina.ts. US-12:
 * suena un aviso con cada tanda de pedidos nuevos y un contador dice cuántos hay en cola y
 * preparándose. US-52: lo terminado baja a la sección gris "Terminados recientes", con Regresar.
 */
export function Cocina() {
  const { pedirConSesion } = useSesion();
  const [lista, setLista] = useState<RespuestaPedidosCocina | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conexion, setConexion] = useState<EstadoConexion>(() =>
    hayRealtime() ? 'conectando' : 'sin_tiempo_real',
  );
  const [resaltados, setResaltados] = useState<ReadonlySet<number>>(new Set());
  const [aviso, setAviso] = useState('');
  const ahora = useAhora(INTERVALO_RELOJ_MS);
  const [sonido, setSonido] = useState<EstadoSonido>(() =>
    hayWebAudio() ? 'bloqueado' : 'sin_audio',
  );

  const anteriores = useRef<TicketCocina[] | null>(null);
  const recargador = useRef<Recargador | null>(null);
  const temporizadores = useRef(new Set<ReturnType<typeof setTimeout>>());
  const avisoSonoro = useRef<AvisoSonoro | null>(null);
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
      const respuesta = await pedirConSesion('/cocina/pedidos', RespuestaPedidosCocinaSchema);
      const { pedidos } = respuesta;
      // Solo la cuadrícula cuenta para "Nuevo" y el aviso: lo regresado vuelve en preparando (D63).
      const nuevos = foliosNuevos(anteriores.current, pedidos);
      anteriores.current = pedidos;
      setLista(respuesta);
      listaRecibida(numero);
      setError(null);
      if (nuevos.length > 0) {
        setAviso(`Llegó el pedido ${nuevos.map((f) => `#${f}`).join(', ')}`);
        avisoSonoro.current?.pedidosNuevos(pedidos.filter((t) => nuevos.includes(t.folio)));
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
    // El navegador solo deja sonar después de que alguien toca la página (US-12).
    const sonoro = crearAvisoSonoro(crearSonadorWebAudio(), setSonido);
    avisoSonoro.current = sonoro;
    const alTocar = () => void sonoro.interaccion();
    document.addEventListener('pointerdown', alTocar);
    document.addEventListener('keydown', alTocar);
    return () => {
      avisoSonoro.current = null;
      document.removeEventListener('pointerdown', alTocar);
      document.removeEventListener('keydown', alTocar);
      sonoro.cerrar();
    };
  }, []);

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

  const pantalla = lista && acciones.vista(lista);
  const vistas = pantalla?.activos;

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-orange-800">Cocina</h1>
        {vistas && (
          <span className="text-xl font-semibold text-stone-800">
            {textoContador(contarPedidos(vistas))}
          </span>
        )}
        <IndicadorConexion estado={conexion} />
      </div>

      <BarraSonido estado={sonido} alAlternar={() => avisoSonoro.current?.alternarSilencio()} />

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

      {lista === null && !error && <p className="mt-8 text-stone-500">Cargando pedidos…</p>}

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
                error={acciones.errores.get(vista.ticket.folio)?.texto}
                alTocar={(accion) => void acciones.tocar(vista, accion)}
              />
            </Ticket>
          ))}
        </ol>
      )}

      {pantalla && (
        <TerminadosRecientes
          terminados={pantalla.terminados}
          ahora={ahora}
          enCuadricula={new Set(pantalla.activos.map((v) => v.ticket.folio))}
          guardando={acciones.guardando}
          errores={acciones.errores}
          alRegresar={(terminado) => void acciones.regresar(terminado)}
          alCerrarError={acciones.descartarError}
        />
      )}
    </section>
  );
}

function BarraSonido({ estado, alAlternar }: { estado: EstadoSonido; alAlternar: () => void }) {
  const aviso = AVISO_SONIDO[estado];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {aviso && (
        <p
          role="status"
          className={`rounded-xl px-4 py-2 text-lg font-semibold ${
            estado === 'bloqueado' ? 'bg-amber-100 text-amber-900' : 'bg-stone-200 text-stone-800'
          }`}
        >
          {aviso}
        </p>
      )}
      {estado !== 'sin_audio' && (
        <button
          type="button"
          onClick={alAlternar}
          className="min-h-12 rounded-xl border border-orange-300 bg-white px-4 text-lg font-semibold text-orange-800"
        >
          {textoBotonSonido(estado)}
        </button>
      )}
    </div>
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
  estado: TicketCocina['estado'];
  nuevo: boolean;
  ahora: number;
  children: ReactNode;
}) {
  const { platillos, aparte } = separarRenglones(ticket);
  const minutos = minutosDesde(ticket.enColaDesde, ahora);
  const atrasado = estaAtrasado(minutos);
  return (
    <li className={clasesTicket({ nuevo, atrasado })}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-3xl font-bold text-stone-900">{ticket.folioTexto}</span>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            estado === 'preparando' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
          }`}
        >
          {nuevo ? 'Nuevo' : ETIQUETA_ESTADO[estado]}
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
