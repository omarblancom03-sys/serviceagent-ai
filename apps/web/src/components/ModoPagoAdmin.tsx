import {
  ConfiguracionRestauranteSchema,
  type ConfiguracionRestaurante,
  type ModoPago,
} from '@serviceagent/shared';
import { useEffect, useState } from 'react';
import { useSesion } from '../auth/SesionContext';
import {
  AVISO_TRANSFERENCIA,
  DESCRIPCION_MODO_PAGO,
  MODOS_EN_PANTALLA,
  mensajeErrorConfiguracion,
  textoUltimoCambio,
} from '../lib/configuracion';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error_carga'; mensaje: string }
  | { tipo: 'listo'; configuracion: ConfiguracionRestaurante };

/**
 * Interruptor del modo de pago en /admin (US-22, D55). Cambiarlo pide confirmar en la misma
 * tarjeta; solo afecta a los pedidos nuevos.
 */
export function ModoPagoAdmin() {
  const { pedirConSesion } = useSesion();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [porConfirmar, setPorConfirmar] = useState<ModoPago | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const [intentoCarga, setIntentoCarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    pedirConSesion('/admin/configuracion', ConfiguracionRestauranteSchema)
      .then((configuracion) => vigente && setEstado({ tipo: 'listo', configuracion }))
      .catch(
        (causa: unknown) =>
          vigente &&
          setEstado({ tipo: 'error_carga', mensaje: mensajeErrorConfiguracion(causa, 'leer') }),
      );
    return () => {
      vigente = false;
    };
  }, [pedirConSesion, intentoCarga]);

  function reintentar() {
    setEstado({ tipo: 'cargando' });
    setIntentoCarga((n) => n + 1);
  }

  async function confirmar(modoPago: ModoPago) {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const configuracion = await pedirConSesion(
        '/admin/configuracion',
        ConfiguracionRestauranteSchema,
        { metodo: 'PATCH', cuerpo: { modoPago } },
      );
      setEstado({ tipo: 'listo', configuracion });
      setPorConfirmar(null);
    } catch (causa) {
      setErrorGuardar(mensajeErrorConfiguracion(causa, 'guardar'));
      // El cambio pudo quedar guardado aunque falle la respuesta: se vuelve a pedir el modo actual.
      try {
        const actual = await pedirConSesion('/admin/configuracion', ConfiguracionRestauranteSchema);
        setEstado({ tipo: 'listo', configuracion: actual });
        if (actual.modoPago === modoPago) setPorConfirmar(null);
      } catch {
        // Si tampoco se puede leer, se queda lo que había en pantalla; el mensaje ya pide revisar.
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section
      aria-labelledby="titulo-modo-pago"
      className="mb-8 rounded-2xl border border-orange-200 bg-white p-5 shadow-sm"
    >
      <h2 id="titulo-modo-pago" className="text-xl font-semibold text-stone-900">
        Modo de pago
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        Decide cómo pagan los clientes y cuándo llega el pedido a cocina. Solo cambia los pedidos
        nuevos.
      </p>

      {estado.tipo === 'cargando' && <p className="mt-4 text-stone-500">Cargando…</p>}

      {estado.tipo === 'error_carga' && (
        <p role="alert" className="mt-4 text-red-800">
          {estado.mensaje}{' '}
          <button type="button" className="font-semibold underline" onClick={reintentar}>
            Reintentar
          </button>
        </p>
      )}

      {estado.tipo === 'listo' && (
        <>
          <div
            role="radiogroup"
            aria-label="Modo de pago"
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            {MODOS_EN_PANTALLA.map((modo) => {
              const activo = estado.configuracion.modoPago === modo;
              const { titulo, detalle } = DESCRIPCION_MODO_PAGO[modo];
              return (
                <button
                  key={modo}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  disabled={guardando || activo}
                  onClick={() => {
                    setErrorGuardar(null);
                    setPorConfirmar(modo);
                  }}
                  className={`rounded-xl border p-4 text-left ${
                    activo
                      ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-300'
                      : 'border-stone-200 hover:border-orange-300'
                  }`}
                >
                  <span className="block font-semibold text-stone-900">
                    {titulo}
                    {activo && <span className="ml-2 text-sm text-orange-700">· Activo</span>}
                  </span>
                  <span className="mt-1 block text-sm text-stone-600">{detalle}</span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-sm text-stone-500">{textoUltimoCambio(estado.configuracion)}</p>

          {porConfirmar && (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-900">
              <p className="font-semibold">
                ¿Cambiar a “{DESCRIPCION_MODO_PAGO[porConfirmar].titulo}”?
              </p>
              {porConfirmar === 'transferencia' && <p className="mt-1">{AVISO_TRANSFERENCIA}</p>}
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => void confirmar(porConfirmar)}
                  className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-700 disabled:opacity-60"
                >
                  {guardando ? 'Guardando…' : 'Sí, cambiar'}
                </button>
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => setPorConfirmar(null)}
                  className="rounded-lg border border-stone-300 px-4 py-2 font-semibold text-stone-700 hover:bg-stone-100"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {errorGuardar && (
            <p role="alert" className="mt-3 text-red-800">
              {errorGuardar}
            </p>
          )}
        </>
      )}
    </section>
  );
}
