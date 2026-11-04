import {
  RespuestaAlertaAtendidaSchema,
  RespuestaAlertasPendientesSchema,
  type AlertaAtencion,
} from '@serviceagent/shared';
import { BellRing, Check, Clock, LoaderCircle, Phone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSesion } from '../auth/SesionContext';
import {
  alertasVisibles,
  crearCandadoAtender,
  datosClienteAlerta,
  deshacerAtendida,
  empezarEnvio,
  enlaceTelefono,
  estadoAtenderInicial,
  hayMasAlertas,
  marcarAtendida,
  mensajeErrorAlertas,
  proximoVencimiento,
  quitarAvisosVencidos,
  resultadoAtender,
  terminarEnvio,
  textoConteoAlertas,
  textoEspera,
  textoTelefono,
  vencidas,
  type EstadoAtender,
} from '../lib/alertasCaja';
import { INTERVALO_REFRESCO_MS, crearRecargador, type Recargador } from '../lib/cocina';
import { escucharSenalAlertas } from '../lib/senalPedidos';
import { INTERVALO_RELOJ_MS } from '../lib/tiempoCocina';
import { useAhora } from '../lib/useAhora';

/**
 * Alertas "Cliente requiere atención" de /caja (US-18, D59): el agente pidió que un empleado
 * llame al cliente. Va arriba del buscador de pedidos, con su propia lista y sus propios errores:
 * si una de las dos listas falla, la otra sigue. Se actualiza igual que los pedidos: señal de
 * Realtime (evento `alerta`) y refresco cada 30 s. El botón Atendida tiene Deshacer
 * (lib/alertasCaja.ts).
 */
export function AlertasCaja() {
  const { pedirConSesion } = useSesion();
  const [alertas, setAlertas] = useState<AlertaAtencion[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<{ causa: unknown } | null>(null);
  const [atender, setAtender] = useState<EstadoAtender>(estadoAtenderInicial);
  const [candado] = useState(crearCandadoAtender);
  const ahora = useAhora(INTERVALO_RELOJ_MS);
  const recargador = useRef<Recargador | null>(null);

  const cargarUnaVez = useCallback(async () => {
    try {
      const respuesta = await pedirConSesion('/caja/alertas', RespuestaAlertasPendientesSchema);
      setAlertas(respuesta.alertas);
      setErrorCarga(null);
    } catch (causa) {
      setErrorCarga({ causa });
    }
  }, [pedirConSesion]);

  useEffect(() => {
    const recarga = crearRecargador(cargarUnaVez);
    recargador.current = recarga;
    void recarga.recargar();
    const refresco = setInterval(() => void recarga.recargar(), INTERVALO_REFRESCO_MS);
    // El punto "En vivo" ya lo pinta Caja.tsx: es el mismo canal.
    const dejarDeEscuchar = escucharSenalAlertas(
      () => recarga.senal(),
      (estado) => recarga.conexion(estado),
    );
    return () => {
      clearInterval(refresco);
      recarga.detener();
      recargador.current = null;
      dejarDeEscuchar?.();
    };
  }, [cargarUnaVez]);

  const enviar = useCallback(
    async (idAlerta: number) => {
      let error: unknown = null;
      try {
        await pedirConSesion(`/caja/alertas/${idAlerta}/atender`, RespuestaAlertaAtendidaSchema, {
          metodo: 'POST',
        });
      } catch (causa) {
        error = causa;
      } finally {
        candado.soltar(idAlerta);
      }
      setAtender((previo) => terminarEnvio(previo, idAlerta, resultadoAtender(error), Date.now()));
      void recargador.current?.recargar();
    },
    [pedirConSesion, candado],
  );

  useEffect(() => {
    // Un solo temporizador: despierta cuando termina el primer plazo o aviso. Al desmontar (cerrar
    // la pestaña o cambiar de pantalla) se cancela y lo que estaba en plazo nunca se manda.
    const proximo = proximoVencimiento(atender);
    if (proximo === null) return;
    const id = setTimeout(
      () => {
        const t = Date.now();
        const ids = vencidas(atender, t);
        setAtender((previo) => quitarAvisosVencidos(empezarEnvio(previo, ids), t));
        for (const idAlerta of ids) if (candado.tomar(idAlerta)) void enviar(idAlerta);
      },
      Math.max(0, proximo - Date.now()),
    );
    return () => clearTimeout(id);
  }, [atender, candado, enviar]);

  const visibles = alertas ? alertasVisibles(alertas, atender) : [];
  const enPlazo = [...atender.enPlazo.values()];
  const enviando = [...atender.enviando.values()];
  const avisos = [...atender.avisos];

  return (
    <section aria-labelledby="titulo-alertas" className="mt-6">
      <h2
        id="titulo-alertas"
        className="flex items-center gap-2 text-xl font-semibold text-stone-800"
      >
        <BellRing aria-hidden="true" className="size-5 text-amber-600" />
        Clientes esperando atención
        {alertas && (
          <span className="font-normal text-stone-500">
            {textoConteoAlertas(visibles.length, alertas.length)}
          </span>
        )}
      </h2>

      <div role="status" className="mt-2 space-y-2">
        {enPlazo.map(({ alerta }) => (
          <p
            key={alerta.idAlerta}
            className="flex flex-wrap items-center gap-x-3 rounded-xl bg-stone-800 px-4 py-2 text-white"
          >
            <span>Alerta marcada como atendida · {textoTelefono(alerta.telefono)}</span>
            <button
              type="button"
              className="font-semibold text-amber-300 underline"
              onClick={() => setAtender((previo) => deshacerAtendida(previo, alerta.idAlerta))}
            >
              Deshacer
            </button>
          </p>
        ))}
        {enviando.map((alerta) => (
          <p
            key={alerta.idAlerta}
            className="flex items-center gap-2 rounded-xl bg-stone-100 px-4 py-2 text-stone-700"
          >
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            Guardando · {textoTelefono(alerta.telefono)}
          </p>
        ))}
        {avisos.map(([idAlerta, aviso]) => (
          <p key={idAlerta} className="rounded-xl bg-sky-50 px-4 py-2 text-sky-900">
            {aviso.texto}
          </p>
        ))}
      </div>

      {errorCarga && (
        <div
          role="alert"
          className={`mt-3 rounded-xl p-3 ${
            alertas === null ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'
          }`}
        >
          {mensajeErrorAlertas(errorCarga.causa, alertas === null)}{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void recargador.current?.recargar()}
          >
            Reintentar ahora
          </button>
        </div>
      )}

      {alertas === null && !errorCarga && <p className="mt-2 text-stone-500">Cargando alertas…</p>}

      {alertas && visibles.length === 0 && (
        <p className="mt-2 text-stone-500">Ningún cliente está esperando atención.</p>
      )}

      {alertas && hayMasAlertas(alertas.length) && (
        <p className="mt-2 text-sm text-stone-600">
          Se muestran las 100 más antiguas; puede haber más.
        </p>
      )}

      {visibles.length > 0 && (
        <ul className="mt-3 grid max-h-[28rem] gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((alerta) => (
            <TarjetaAlerta
              key={alerta.idAlerta}
              alerta={alerta}
              ahora={ahora}
              error={atender.errores.get(alerta.idAlerta) ?? null}
              alAtender={() => setAtender((previo) => marcarAtendida(previo, alerta, Date.now()))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TarjetaAlerta({
  alerta,
  ahora,
  error,
  alAtender,
}: {
  alerta: AlertaAtencion;
  ahora: number;
  error: string | null;
  alAtender: () => void;
}) {
  const { nombre, folio } = datosClienteAlerta(alerta);
  return (
    <li className="flex flex-col rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-amber-900">Cliente requiere atención</span>
        <span className="flex items-center gap-1 text-sm text-stone-600">
          <Clock aria-hidden="true" className="size-4" />
          {textoEspera(alerta.creadaEn, ahora)}
        </span>
      </div>
      <a
        href={enlaceTelefono(alerta.telefono)}
        className="mt-2 flex items-center gap-2 text-2xl font-bold text-stone-900 underline-offset-4 hover:underline"
      >
        <Phone aria-hidden="true" className="size-5" />
        {textoTelefono(alerta.telefono)}
      </a>
      <p className="mt-1 text-stone-700">
        {nombre} · {folio}
      </p>
      {/* El motivo lo escribe la IA: siempre como texto de React, nunca como HTML. */}
      <p className="mt-2 break-words whitespace-pre-wrap text-stone-800">{alerta.motivo}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={alAtender}
        className="mt-3 flex items-center justify-center gap-2 self-end rounded-xl bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700"
      >
        <Check aria-hidden="true" className="size-5" />
        Atendida
      </button>
    </li>
  );
}
