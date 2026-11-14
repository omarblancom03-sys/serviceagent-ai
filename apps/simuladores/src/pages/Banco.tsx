import { TransferenciaBancoSchema } from '@serviceagent/shared';
import { useState, type FormEvent } from 'react';
import { enviarApi } from '../lib/api';
import {
  agregarAlHistorial,
  almacenDelNavegador,
  aplicarErrorSimulado,
  ERRORES_SIMULADOS,
  formatearClabe,
  formatearFecha,
  leerFormulario,
  leerHistorial,
  mensajeDeError,
  TEXTO_ERROR_SIMULADO,
  type CamposBanco,
  type ErroresBanco,
  type ErrorSimulado,
  type TransferenciaEnviada,
} from '../lib/banco';

/**
 * Banco Simulado (US-24, D70): la "app del banco" del cliente. Captura CLABE, monto y referencia,
 * hace la transferencia en el servidor del banco (que le avisa al restaurante con el webhook
 * firmado) y guarda el historial en este navegador. Toda la lógica está en `lib/banco.ts`.
 */

const CAMPOS_VACIOS: CamposBanco = { clabe: '', monto: '', referencia: '' };

const DESCRIPCION_ERROR: Record<ErrorSimulado, string> = {
  monto_distinto: 'Manda un peso menos de lo que escribiste.',
  referencia_equivocada: 'Cambia el último carácter de la referencia.',
};

const claseCampo =
  'w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 ' +
  'placeholder:text-slate-600 focus:border-sky-400 focus:outline-none';

export function Banco() {
  const [campos, setCampos] = useState<CamposBanco>(CAMPOS_VACIOS);
  const [errores, setErrores] = useState<ErroresBanco>({});
  const [errorSimulado, setErrorSimulado] = useState<ErrorSimulado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [falla, setFalla] = useState<string | null>(null);
  const [ultima, setUltima] = useState<TransferenciaEnviada | null>(null);
  const [historial, setHistorial] = useState<TransferenciaEnviada[]>(() =>
    leerHistorial(almacenDelNavegador()),
  );

  const cambiar = (campo: keyof CamposBanco) => (valor: string) => {
    setCampos((actuales) => ({ ...actuales, [campo]: valor }));
    setErrores((actuales) => ({ ...actuales, [campo]: undefined }));
  };

  async function transferir(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    const formulario = leerFormulario(campos);
    if (!formulario.ok) {
      setErrores(formulario.errores);
      return;
    }

    setEnviando(true);
    setFalla(null);
    setUltima(null);
    try {
      const transferencia = await enviarApi(
        '/banco-simulado/transferencias',
        TransferenciaBancoSchema,
        aplicarErrorSimulado(formulario.peticion, errorSimulado),
      );
      const enviada: TransferenciaEnviada = { transferencia, errorSimulado };
      setHistorial((actual) => agregarAlHistorial(almacenDelNavegador(), actual, enviada));
      setUltima(enviada);
      setErrorSimulado(null);
    } catch (error) {
      setFalla(mensajeDeError(error));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-sky-300">Banco Simulado</h1>
        <p className="mt-1 text-sm text-slate-400">
          Banca en línea de práctica. Aquí no se mueve dinero real.
        </p>
      </header>

      <form
        onSubmit={(evento) => void transferir(evento)}
        noValidate
        className="space-y-5 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold text-slate-100">Nueva transferencia</h2>

        <Campo
          id="clabe"
          etiqueta="CLABE destino"
          ayuda="18 dígitos."
          error={errores.clabe}
          valor={campos.clabe}
          alCambiar={cambiar('clabe')}
          inputMode="numeric"
          placeholder="000000000000000000"
        />
        <Campo
          id="monto"
          etiqueta="Monto (MXN)"
          ayuda="En pesos, por ejemplo 188.00."
          error={errores.monto}
          valor={campos.monto}
          alCambiar={cambiar('monto')}
          inputMode="decimal"
          placeholder="0.00"
        />
        <Campo
          id="referencia"
          etiqueta="Referencia"
          ayuda="La que te dio el restaurante."
          error={errores.referencia}
          valor={campos.referencia}
          alCambiar={cambiar('referencia')}
          placeholder="Referencia de pago"
        />

        <fieldset className="rounded border border-dashed border-amber-500/40 p-4">
          <legend className="px-2 text-xs uppercase tracking-wide text-amber-300">
            Solo para pruebas: simular un error
          </legend>
          <div className="space-y-2 text-sm">
            <OpcionError
              marcado={errorSimulado === null}
              alElegir={() => setErrorSimulado(null)}
              titulo="Sin error"
              descripcion="Manda exactamente lo que escribiste."
            />
            {ERRORES_SIMULADOS.map((error) => (
              <OpcionError
                key={error}
                marcado={errorSimulado === error}
                alElegir={() => setErrorSimulado(error)}
                titulo={TEXTO_ERROR_SIMULADO[error]}
                descripcion={DESCRIPCION_ERROR[error]}
              />
            ))}
          </div>
        </fieldset>

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded bg-sky-500 px-4 py-3 font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {enviando ? 'Transfiriendo…' : 'Transferir'}
        </button>

        {falla && (
          <p
            role="alert"
            className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"
          >
            {falla}
          </p>
        )}
        {ultima && <Comprobante enviada={ultima} />}
      </form>

      <section aria-labelledby="titulo-historial">
        <h2 id="titulo-historial" className="text-lg font-semibold text-slate-100">
          Transferencias enviadas
        </h2>
        {historial.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Todavía no has hecho transferencias.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Fecha
                  </th>
                  <th scope="col" className="px-4 py-2 text-right">
                    Monto
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Referencia
                  </th>
                  <th scope="col" className="px-4 py-2">
                    CLABE destino
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {historial.map(({ transferencia, errorSimulado: simulado }) => (
                  <tr key={transferencia.idTransferencia}>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-300">
                      {formatearFecha(transferencia.fecha)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-slate-100">
                      {transferencia.montoTexto}
                    </td>
                    <td className="px-4 py-2 text-slate-100">
                      {transferencia.referencia}
                      {simulado && (
                        <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                          {TEXTO_ERROR_SIMULADO[simulado]}
                        </span>
                      )}
                      {!transferencia.avisoEntregado && (
                        <span className="ml-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-xs text-rose-300">
                          Aviso no entregado
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-400">
                      {formatearClabe(transferencia.clabeDestino)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Campo(props: {
  id: string;
  etiqueta: string;
  ayuda: string;
  error: string | undefined;
  valor: string;
  alCambiar: (valor: string) => void;
  inputMode?: 'numeric' | 'decimal';
  placeholder: string;
}) {
  const idAyuda = `${props.id}-ayuda`;
  return (
    <div>
      <label htmlFor={props.id} className="mb-1 block text-sm text-slate-300">
        {props.etiqueta}
      </label>
      <input
        id={props.id}
        type="text"
        autoComplete="off"
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        value={props.valor}
        onChange={(evento) => props.alCambiar(evento.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={idAyuda}
        className={claseCampo}
      />
      <p
        id={idAyuda}
        className={`mt-1 text-xs ${props.error ? 'text-rose-300' : 'text-slate-500'}`}
      >
        {props.error ?? props.ayuda}
      </p>
    </div>
  );
}

function OpcionError(props: {
  marcado: boolean;
  alElegir: () => void;
  titulo: string;
  descripcion: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="radio"
        name="error-simulado"
        checked={props.marcado}
        onChange={props.alElegir}
        className="mt-1 accent-amber-400"
      />
      <span>
        <span className="text-slate-100">{props.titulo}</span>
        <span className="block text-xs text-slate-500">{props.descripcion}</span>
      </span>
    </label>
  );
}

function Comprobante({ enviada }: { enviada: TransferenciaEnviada }) {
  const { transferencia, errorSimulado } = enviada;
  return (
    <div
      role="status"
      className="rounded border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
    >
      <p className="font-semibold text-emerald-200">Transferencia enviada</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-slate-200">
        <dt className="text-slate-400">Monto</dt>
        <dd>{transferencia.montoTexto}</dd>
        <dt className="text-slate-400">Referencia</dt>
        <dd>{transferencia.referencia}</dd>
        <dt className="text-slate-400">CLABE destino</dt>
        <dd>{formatearClabe(transferencia.clabeDestino)}</dd>
        <dt className="text-slate-400">Fecha</dt>
        <dd>{formatearFecha(transferencia.fecha)}</dd>
      </dl>
      {errorSimulado && (
        <p className="mt-2 text-amber-300">
          Error simulado: {TEXTO_ERROR_SIMULADO[errorSimulado].toLowerCase()}. Arriba está lo que se
          mandó de verdad.
        </p>
      )}
      {!transferencia.avisoEntregado && (
        <p className="mt-2 text-rose-300">
          La transferencia salió, pero el restaurante no confirmó que recibió el aviso.
        </p>
      )}
    </div>
  );
}
