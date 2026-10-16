import { RespuestaMenuSchema, type Platillo, type RespuestaMenu } from '@serviceagent/shared';
import { useEffect, useMemo, useState } from 'react';
import { pedirApi } from '../lib/api';
import { filtrarMenu, formatearHora, formatearPesos, resumirMenu } from '../lib/menuAdmin';
import {
  mensajeErrorMenu,
  nombreVarianteVisible,
  opcionesVista,
  unirClases,
  type ModoMenu,
  type OpcionesVista,
} from '../lib/menuVista';

type EstadoMenu =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; menu: RespuestaMenu };

const CLASE_CAMPO =
  'rounded-lg border border-stone-300 px-3 py-2 text-base font-normal focus:border-orange-500 focus:ring-2 focus:ring-orange-200 focus:outline-none';
const CLASE_SELECTOR =
  'rounded-lg border border-stone-300 bg-white px-3 py-2 text-base font-normal focus:border-orange-500 focus:ring-2 focus:ring-orange-200 focus:outline-none';

/**
 * Menú de solo lectura de `GET /menu` con búsqueda y filtro por categoría, para /admin y /menu.
 * Lo que cambia entre pantallas sale de `opcionesVista(modo)`. Los precios se muestran tal como
 * los manda la API.
 */
export function ListadoMenu({ modo }: { modo: ModoMenu }) {
  const opciones = opcionesVista(modo);
  const [estado, setEstado] = useState<EstadoMenu>({ tipo: 'cargando' });
  const [intentoCarga, setIntentoCarga] = useState(0);
  const [busqueda, setBusqueda] = useState('');
  const [idCategoria, setIdCategoria] = useState<number | null>(null);

  useEffect(() => {
    let vigente = true;
    pedirApi('/menu', RespuestaMenuSchema)
      .then((menu) => vigente && setEstado({ tipo: 'listo', menu }))
      .catch(
        (error: unknown) =>
          vigente &&
          setEstado({ tipo: 'error', mensaje: mensajeErrorMenu(error, opciones.errorDetallado) }),
      );
    return () => {
      vigente = false;
    };
  }, [intentoCarga, opciones.errorDetallado]);

  const menu = estado.tipo === 'listo' ? estado.menu : null;
  const filtrado = useMemo(
    () =>
      menu
        ? filtrarMenu(menu, {
            busqueda,
            idCategoria,
            buscarPorCategoria: opciones.buscarPorCategoria,
          })
        : null,
    [menu, busqueda, idCategoria, opciones.buscarPorCategoria],
  );
  const resumen = useMemo(() => (menu ? resumirMenu(menu) : null), [menu]);
  const visibles = useMemo(() => (filtrado ? resumirMenu(filtrado) : null), [filtrado]);

  return (
    <section>
      <h1 className="text-3xl font-bold text-orange-800">Menú</h1>
      <p className="mt-1 text-stone-600">{opciones.subtitulo}</p>

      {estado.tipo === 'cargando' && <p className="mt-8 text-stone-500">Cargando menú…</p>}

      {estado.tipo === 'error' && (
        <div role="alert" className="mt-8 rounded-xl bg-red-50 p-4 text-red-800">
          {estado.mensaje}{' '}
          <button
            type="button"
            className={opciones.claseReintentar}
            onClick={() => {
              setEstado({ tipo: 'cargando' });
              setIntentoCarga((n) => n + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {menu && filtrado && resumen && visibles && (
        <>
          <div
            className={unirClases(
              opciones.claseBarraFija,
              'mt-6 rounded-2xl border border-orange-200 bg-white p-4 shadow-sm',
            )}
          >
            <div className="flex flex-col gap-3 md:flex-row">
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-stone-700">
                {opciones.etiquetaBusqueda}
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder={opciones.placeholderBusqueda}
                  className={unirClases(CLASE_CAMPO, opciones.claseCampo)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-stone-700 md:w-64">
                Categoría
                <select
                  value={idCategoria ?? ''}
                  onChange={(e) =>
                    setIdCategoria(e.target.value === '' ? null : Number(e.target.value))
                  }
                  className={unirClases(CLASE_SELECTOR, opciones.claseCampo)}
                >
                  <option value="">Todas</option>
                  {menu.categorias.map((categoria) => (
                    <option key={categoria.id} value={categoria.id}>
                      {categoria.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {opciones.mostrarResumen && (
              <p className="mt-3 text-sm text-stone-600">
                Cargado: {resumen.categorias} categorías · {resumen.platillos} platillos ·{' '}
                {resumen.variantes} variantes · {resumen.extrasSueltos} extras sueltos
                {opciones.mostrarHora && <> · actualizado a las {formatearHora(menu.timestamp)}</>}
              </p>
            )}
            {opciones.mostrarConteoFiltrado && (
              <p className="text-sm text-stone-500">
                Mostrando {visibles.platillos} platillos y {visibles.extrasSueltos} extras sueltos.
              </p>
            )}
            {opciones.mostrarLeyendaPrep && (
              <p className="mt-1 text-xs text-stone-400">
                Prep. = tiempo base de preparación, en minutos.
              </p>
            )}
          </div>

          {filtrado.categorias.length === 0 && filtrado.extras.length === 0 && (
            <p className="mt-8 text-center text-stone-500">Sin resultados.</p>
          )}

          {filtrado.categorias.map((categoria) => (
            <section key={categoria.id} className="mt-8">
              <h2 className="text-xl font-bold text-orange-800">{categoria.nombre}</h2>
              {categoria.descripcion && (
                <p className="text-sm text-stone-600">{categoria.descripcion}</p>
              )}
              <ul className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                {categoria.platillos.map((platillo) => (
                  <li key={platillo.id}>
                    <TarjetaPlatillo platillo={platillo} opciones={opciones} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {filtrado.extras.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xl font-bold text-orange-800">Extras sueltos</h2>
              <p className="text-sm text-stone-600">Se venden por separado y se cobran aparte.</p>
              <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {filtrado.extras.map((extra) => (
                  <li
                    key={extra.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4"
                  >
                    <div>
                      <p className="font-semibold">
                        {extra.nombre} {!extra.disponible && <EtiquetaAgotado />}
                      </p>
                      {extra.descripcion && (
                        <p className="text-sm text-stone-600">{extra.descripcion}</p>
                      )}
                    </div>
                    <span className="font-semibold whitespace-nowrap text-stone-800">
                      {formatearPesos(extra.precioCentavos)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function TarjetaPlatillo({ platillo, opciones }: { platillo: Platillo; opciones: OpcionesVista }) {
  return (
    <article className="h-full rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">
          {platillo.nombre} {!platillo.disponible && <EtiquetaAgotado />}
        </h3>
        {opciones.mostrarTiempoPrep && (
          <span
            title="Tiempo base de preparación de la categoría"
            className="rounded-full bg-stone-100 px-2 py-0.5 text-xs whitespace-nowrap text-stone-600"
          >
            {platillo.tiempoEstimadoMin === null
              ? 'Sin tiempo de prep.'
              : `Prep. ${platillo.tiempoEstimadoMin} min`}
          </span>
        )}
      </div>
      {platillo.descripcion && (
        <p className="mt-1 text-sm text-stone-600">{platillo.descripcion}</p>
      )}

      <ul className="mt-3 divide-y divide-stone-100 border-t border-stone-100">
        {platillo.variantes.map((variante) => (
          <li key={variante.id} className="flex items-start justify-between gap-3 py-1.5">
            <span>
              {nombreVarianteVisible(
                variante,
                platillo.variantes.length,
                opciones.simplificarVarianteUnica,
              )}{' '}
              {!variante.disponible && <EtiquetaAgotado />}
              {variante.descripcion && (
                <span className="block text-xs text-stone-500">{variante.descripcion}</span>
              )}
            </span>
            <span className="font-semibold whitespace-nowrap">
              {formatearPesos(variante.precioCentavos)}
            </span>
          </li>
        ))}
      </ul>

      {platillo.extrasPermitidos.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold tracking-wide text-orange-700 uppercase">
            Extras permitidos
          </p>
          <ul className="mt-1 text-sm">
            {platillo.extrasPermitidos.map((extra) => (
              <li key={extra.id} className="flex justify-between gap-3">
                <span>
                  {extra.nombre} {!extra.disponible && <EtiquetaAgotado />}
                </span>
                <span className="whitespace-nowrap">{formatearPesos(extra.precioCentavos)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {platillo.ingredientesRemovibles.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold tracking-wide text-orange-700 uppercase">
            Se puede quitar
          </p>
          <p className="text-sm text-stone-700">
            {platillo.ingredientesRemovibles.map((ingrediente) => ingrediente.nombre).join(', ')}
          </p>
        </div>
      )}
    </article>
  );
}

function EtiquetaAgotado() {
  return (
    <span className="ml-1 inline-block rounded-full bg-red-100 px-2 py-0.5 align-middle text-xs font-semibold text-red-700">
      Agotado
    </span>
  );
}
