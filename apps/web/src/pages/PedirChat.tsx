import {
  RespuestaEnviarMensajeSchema,
  RespuestaIniciarConversacionSchema,
} from '@serviceagent/shared';
import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import { pedirApi } from '../lib/api';
import {
  BOTONES_RAPIDOS,
  botonesRapidosVisibles,
  clasificarErrorChat,
  estadoInicial,
  puedeEscribir,
  reducirChat,
  validarTexto,
  type Burbuja as DatosBurbuja,
  type PasoChat,
} from '../lib/chat';
import { separarEnlaces } from '../lib/enlaces';

/** Chat del cliente con el asistente de pedidos (US-09-P2). La lógica vive en `lib/chat.ts`. */
export function PedirChat() {
  const [estado, despachar] = useReducer(reducirChat, undefined, estadoInicial);
  const [borrador, setBorrador] = useState('');
  const [errorTexto, setErrorTexto] = useState<string | null>(null);
  const finLista = useRef<HTMLDivElement>(null);
  const cajaTexto = useRef<HTMLInputElement>(null);
  const faseAnterior = useRef(estado.fase);

  const activo = puedeEscribir(estado);
  const enviando = estado.fase === 'enviando';

  useEffect(() => {
    finLista.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [estado.burbujas.length, estado.fase]);

  // Tras una respuesta (enviando -> listo) el foco vuelve a la caja; al cargar no se enfoca.
  useEffect(() => {
    if (faseAnterior.current === 'enviando' && estado.fase === 'listo') cajaTexto.current?.focus();
    faseAnterior.current = estado.fase;
  }, [estado.fase]);

  /** Crea la conversación si aún no existe y luego envía el texto. */
  async function ejecutar(texto: string) {
    let paso: PasoChat = 'crear';
    let limite = estado.limiteMensajes;
    try {
      let id = estado.conversacionId;
      if (id === null) {
        const abierta = await pedirApi('/chat/conversaciones', RespuestaIniciarConversacionSchema, {
          metodo: 'POST',
        });
        despachar({ tipo: 'conversacionCreada', ...abierta });
        id = abierta.conversacionId;
        limite = abierta.limiteMensajes;
      }
      paso = 'enviar';
      const respuesta = await pedirApi(
        `/chat/conversaciones/${encodeURIComponent(id)}/mensajes`,
        RespuestaEnviarMensajeSchema,
        { metodo: 'POST', cuerpo: { texto } },
      );
      despachar({ tipo: 'respuesta', ...respuesta });
    } catch (error) {
      despachar({ tipo: 'fallo', falla: clasificarErrorChat(error, paso, limite) });
    }
  }

  function enviar(texto: string) {
    if (!activo) return;
    const validacion = validarTexto(texto);
    if (!validacion.ok) {
      setErrorTexto(validacion.mensaje);
      return;
    }
    setErrorTexto(null);
    setBorrador('');
    despachar({ tipo: 'enviar', texto: validacion.texto });
    void ejecutar(validacion.texto);
  }

  function reintentar() {
    if (estado.fase !== 'error' || estado.pendiente === null) return;
    despachar({ tipo: 'reintentar' });
    void ejecutar(estado.pendiente);
  }

  function iniciarOtra() {
    setBorrador('');
    setErrorTexto(null);
    despachar({ tipo: 'iniciarOtra' });
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    enviar(borrador);
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-9rem)] min-h-96 w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-orange-200 bg-orange-50">
      <header className="flex items-center gap-3 border-b border-orange-200 bg-white px-4 py-3">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-700 text-sm font-bold text-white"
        >
          AI
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-stone-900">El Granero</h1>
          <p className="text-sm text-stone-600">Asistente de pedidos</p>
        </div>
        <p className="shrink-0 text-sm text-stone-600">
          {estado.mensajesUsados} / {estado.limiteMensajes} mensajes
        </p>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ul aria-live="polite" className="flex flex-col gap-3">
          {estado.burbujas.map((burbuja) => (
            <Burbuja key={burbuja.id} burbuja={burbuja} />
          ))}
        </ul>
        {enviando && (
          <p className="mt-3 text-sm text-stone-600" role="status">
            Escribiendo…
          </p>
        )}
        {estado.aviso && (
          <div
            role="status"
            className="mt-3 rounded-xl border border-orange-200 bg-white p-3 text-sm text-stone-900"
          >
            <p>{estado.aviso.mensaje}</p>
            {estado.aviso.accion === 'reintentar' && (
              <button type="button" onClick={reintentar} className={claseBotonAccion}>
                Reintentar
              </button>
            )}
            {estado.aviso.accion === 'iniciar_otra' && (
              <button type="button" onClick={iniciarOtra} className={claseBotonAccion}>
                Iniciar otra
              </button>
            )}
          </div>
        )}
        <div ref={finLista} />
      </div>

      <div className="border-t border-orange-200 bg-white px-4 py-3">
        {botonesRapidosVisibles(estado) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {BOTONES_RAPIDOS.map((texto) => (
              <button
                key={texto}
                type="button"
                disabled={!activo}
                onClick={() => enviar(texto)}
                className="rounded-full border border-orange-200 px-3 py-1 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {texto}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={alEnviar} className="flex gap-2">
          <label htmlFor="mensaje-chat" className="sr-only">
            Escribe tu mensaje
          </label>
          <input
            ref={cajaTexto}
            id="mensaje-chat"
            type="text"
            autoComplete="off"
            value={borrador}
            disabled={!activo}
            onChange={(e) => setBorrador(e.target.value)}
            placeholder="Escribe tu mensaje…"
            aria-invalid={errorTexto !== null}
            aria-describedby={errorTexto ? 'error-mensaje-chat' : undefined}
            className="min-w-0 flex-1 rounded-xl border border-orange-200 px-3 py-2 text-stone-900 focus:border-orange-700 focus:outline-none disabled:bg-stone-100"
          />
          <button
            type="submit"
            disabled={!activo}
            className="rounded-xl bg-orange-700 px-4 py-2 font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
        {errorTexto && (
          <p id="error-mensaje-chat" className="mt-1 text-sm text-orange-700">
            {errorTexto}
          </p>
        )}
      </div>
    </section>
  );
}

const claseBotonAccion =
  'mt-2 rounded-lg bg-orange-700 px-3 py-1.5 font-semibold text-white hover:bg-orange-800';

function Burbuja({ burbuja }: { burbuja: DatosBurbuja }) {
  const esCliente = burbuja.autor === 'cliente';
  return (
    <li className={esCliente ? 'flex justify-end' : 'flex justify-start'}>
      <p
        className={
          esCliente
            ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-orange-700 px-3 py-2 break-words whitespace-pre-wrap text-white'
            : 'max-w-[85%] rounded-2xl rounded-bl-sm border border-orange-200 bg-white px-3 py-2 break-words whitespace-pre-wrap text-stone-900'
        }
      >
        <span className="sr-only">{esCliente ? 'Tú: ' : 'Asistente: '}</span>
        <TextoConEnlaces texto={burbuja.texto} />
      </p>
    </li>
  );
}

/** Pinta el mensaje como texto de React; las URLs http/https se vuelven enlaces. */
function TextoConEnlaces({ texto }: { texto: string }) {
  return (
    <>
      {separarEnlaces(texto).map((segmento, i) =>
        segmento.tipo === 'enlace' ? (
          <a
            key={i}
            href={segmento.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {segmento.url}
          </a>
        ) : (
          <span key={i}>{segmento.valor}</span>
        ),
      )}
    </>
  );
}
