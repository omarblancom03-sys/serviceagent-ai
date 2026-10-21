import { RespuestaPedidosCajaSchema, type PedidoCaja } from '@serviceagent/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSesion } from '../auth/SesionContext';
import { IndicadorConexion } from '../components/IndicadorConexion';
import {
  ETIQUETA_ESTADO_CAJA,
  agruparPedidosCaja,
  coincideBusqueda,
  mensajeErrorCaja,
  textoHoraPedido,
  textoPago,
  type GrupoCaja,
  type TipoPago,
} from '../lib/caja';
import {
  INTERVALO_REFRESCO_MS,
  ZONA_HORARIA_RESTAURANTE,
  crearRecargador,
  type EstadoConexion,
  type Recargador,
} from '../lib/cocina';
import { escucharSenalPedidos, hayRealtime } from '../lib/senalPedidos';

/**
 * Pantalla de caja (US-20): los pedidos del día con su estado y si ya están pagados. Se actualiza
 * sola igual que cocina: la señal de Realtime avisa que algo cambió (un pedido o un pago) y la
 * lista se vuelve a pedir a la API; si la señal se pierde, cada 30 s. Cobrar y entregar llegan
 * con US-21.
 */
export function Caja() {
  const { pedirConSesion } = useSesion();
  const [pedidos, setPedidos] = useState<PedidoCaja[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [conexion, setConexion] = useState<EstadoConexion>(() =>
    hayRealtime() ? 'conectando' : 'sin_tiempo_real',
  );
  const recargador = useRef<Recargador | null>(null);

  const cargarUnaVez = useCallback(async () => {
    try {
      const respuesta = await pedirConSesion('/caja/pedidos', RespuestaPedidosCajaSchema);
      setPedidos(respuesta.pedidos);
      setError(null);
    } catch (causa) {
      setError(mensajeErrorCaja(causa));
    }
  }, [pedirConSesion]);

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

    return () => {
      clearInterval(refresco);
      recarga.detener();
      recargador.current = null;
      dejarDeEscuchar?.();
    };
  }, [cargarUnaVez]);

  const encontrados = pedidos?.filter((p) => coincideBusqueda(p, busqueda)) ?? [];
  const buscando = busqueda.trim() !== '';

  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold text-orange-800">Caja</h1>
        {pedidos && (
          <span className="text-lg text-stone-600">
            {pedidos.length === 1 ? '1 pedido' : `${pedidos.length} pedidos`}
          </span>
        )}
        <IndicadorConexion estado={conexion} />
      </div>

      <label className="mt-4 block max-w-md">
        <span className="sr-only">Buscar por folio o nombre</span>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por folio o nombre"
          className="w-full rounded-xl border border-orange-200 bg-white px-4 py-2.5 text-lg focus:border-orange-400 focus:outline-none"
        />
      </label>

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

      {pedidos === null && !error && <p className="mt-8 text-stone-500">Cargando pedidos…</p>}

      {pedidos?.length === 0 && (
        <p className="mt-12 text-center text-xl text-stone-500">Todavía no hay pedidos hoy.</p>
      )}

      {pedidos && pedidos.length > 0 && buscando && encontrados.length === 0 && (
        <p className="mt-8 text-stone-500">Ningún pedido coincide con “{busqueda.trim()}”.</p>
      )}

      {pedidos &&
        pedidos.length > 0 &&
        (!buscando || encontrados.length > 0) &&
        agruparPedidosCaja(encontrados).map((grupo) => (
          <Grupo key={grupo.id} grupo={grupo} buscando={buscando} />
        ))}
    </section>
  );
}

function Grupo({ grupo, buscando }: { grupo: GrupoCaja; buscando: boolean }) {
  // Al buscar, los grupos sin resultados no se muestran.
  if (buscando && grupo.pedidos.length === 0) return null;
  return (
    <section className="mt-8" aria-labelledby={`grupo-${grupo.id}`}>
      <h2 id={`grupo-${grupo.id}`} className="text-xl font-semibold text-stone-800">
        {grupo.titulo} <span className="font-normal text-stone-500">({grupo.pedidos.length})</span>
      </h2>
      {grupo.pedidos.length === 0 ? (
        <p className="mt-2 text-stone-500">Ninguno.</p>
      ) : (
        <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {grupo.pedidos.map((pedido) => (
            <TarjetaPedido key={pedido.folio} pedido={pedido} />
          ))}
        </ol>
      )}
    </section>
  );
}

const CLASE_PAGO: Record<TipoPago, string> = {
  pagado: 'bg-green-100 text-green-800',
  por_cobrar: 'bg-amber-100 text-amber-900',
  sin_cobro: 'bg-stone-100 text-stone-600',
};

function TarjetaPedido({ pedido }: { pedido: PedidoCaja }) {
  const pago = textoPago(pedido);
  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        pedido.estado === 'listo' ? 'border-green-300' : 'border-orange-200'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold text-stone-900">{pedido.folioTexto}</span>
        <span className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-800">
          {ETIQUETA_ESTADO_CAJA[pedido.estado]}
        </span>
      </div>
      <p className="mt-1 text-stone-700">
        {pedido.nombreCliente} · tel. ···{pedido.telefonoFinal}
      </p>
      <p className="text-sm text-stone-500">
        {textoHoraPedido(pedido.creadoEn, new Date(), ZONA_HORARIA_RESTAURANTE)}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xl font-semibold text-stone-900">{pedido.totalTexto}</span>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${CLASE_PAGO[pago.tipo]}`}>
          {pago.tipo === 'pagado' && <span aria-hidden="true">✓ </span>}
          {pago.texto}
        </span>
      </div>
    </li>
  );
}
