import { EmpleadoPublicoSchema, SesionSchema, type EmpleadoPublico } from '@serviceagent/shared';
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { mensajeErrorLogin } from '../auth/mensajes';
import { destinoTrasLogin, NOMBRE_ROL, pantallaInicial } from '../auth/permisos';
import { useSesion } from '../auth/SesionContext';
import { ErrorApi, pedirApi } from '../lib/api';

const LARGO_PIN = 4;
const ListaEmpleadosSchema = EmpleadoPublicoSchema.array();

type EstadoLista =
  { tipo: 'cargando' } | { tipo: 'error' } | { tipo: 'lista'; empleados: EmpleadoPublico[] };

/**
 * Pantalla de acceso (US-04): el empleado toca su tarjeta y escribe su PIN en un teclado
 * numérico grande, como si pusiera su huella. Al completar 4 dígitos se envía solo.
 */
export function Login() {
  const { sesion, iniciarSesion } = useSesion();
  const navigate = useNavigate();
  const desde = (useLocation().state as { desde?: string } | null)?.desde;

  const [lista, setLista] = useState<EstadoLista>({ tipo: 'cargando' });
  const [intentoCarga, setIntentoCarga] = useState(0);
  const [elegido, setElegido] = useState<EmpleadoPublico | null>(null);
  const [pin, setPin] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vigente = true;
    pedirApi('/auth/empleados', ListaEmpleadosSchema)
      .then((empleados) => vigente && setLista({ tipo: 'lista', empleados }))
      .catch(() => vigente && setLista({ tipo: 'error' }));
    return () => {
      vigente = false;
    };
  }, [intentoCarga]);

  if (sesion) return <Navigate to={pantallaInicial(sesion.payload.rol)} replace />;

  function elegir(empleado: EmpleadoPublico | null) {
    setElegido(empleado);
    setPin('');
    setMensaje(null);
  }

  async function enviar(empleado: EmpleadoPublico, pinCompleto: string) {
    setEnviando(true);
    try {
      const respuesta = await pedirApi('/auth/login', SesionSchema, {
        metodo: 'POST',
        cuerpo: { empleadoId: empleado.id, pin: pinCompleto },
      });
      if (!iniciarSesion(respuesta)) throw new Error('Token inválido');
      navigate(destinoTrasLogin(respuesta.empleado.rol, desde), { replace: true });
    } catch (error) {
      setPin('');
      setMensaje(
        error instanceof ErrorApi
          ? mensajeErrorLogin(error.status, error.cuerpo)
          : 'No se pudo conectar con el sistema. Revisa la conexión e intenta de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  }

  function teclear(digito: string) {
    if (!elegido || enviando || pin.length >= LARGO_PIN) return;
    const nuevo = pin + digito;
    setPin(nuevo);
    setMensaje(null);
    if (nuevo.length === LARGO_PIN) void enviar(elegido, nuevo);
  }

  if (!elegido) {
    return (
      <section className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold text-orange-800">¿Quién eres?</h1>
        <p className="mt-1 text-stone-600">Toca tu nombre para entrar con tu PIN.</p>

        {lista.tipo === 'cargando' && <p className="mt-8 text-stone-500">Cargando empleados…</p>}
        {lista.tipo === 'error' && (
          <div className="mt-8 rounded-xl bg-red-50 p-4 text-red-800">
            No se pudo cargar la lista de empleados.{' '}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                setLista({ tipo: 'cargando' });
                setIntentoCarga((n) => n + 1);
              }}
            >
              Reintentar
            </button>
          </div>
        )}
        {lista.tipo === 'lista' && (
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {lista.empleados.map((empleado) => (
              <li key={empleado.id}>
                <button
                  type="button"
                  onClick={() => elegir(empleado)}
                  className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-orange-200 bg-white p-6 shadow-sm transition hover:border-orange-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-300"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-2xl font-bold text-orange-700">
                    {empleado.nombre.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-lg font-semibold">{empleado.nombre}</span>
                  <span className="text-sm text-stone-500">{NOMBRE_ROL[empleado.rol]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-sm flex-col items-center">
      <button
        type="button"
        onClick={() => elegir(null)}
        className="self-start text-stone-600 hover:text-orange-700"
      >
        ← Cambiar empleado
      </button>
      <h1 className="mt-4 text-2xl font-bold text-orange-800">{elegido.nombre}</h1>
      <p className="text-stone-600">Escribe tu PIN</p>

      <div className="mt-6 flex gap-4" aria-label={`${pin.length} de ${LARGO_PIN} dígitos`}>
        {Array.from({ length: LARGO_PIN }, (_, i) => (
          <span
            key={i}
            className={`h-5 w-5 rounded-full border-2 border-orange-600 ${i < pin.length ? 'bg-orange-600' : ''}`}
          />
        ))}
      </div>

      <p role="alert" className="mt-4 min-h-6 text-center font-medium text-red-700">
        {enviando ? <span className="text-stone-500">Verificando…</span> : mensaje}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digito) => (
          <TeclaPin key={digito} onClick={() => teclear(digito)} disabled={enviando}>
            {digito}
          </TeclaPin>
        ))}
        <TeclaPin onClick={() => setPin('')} disabled={enviando} secundaria>
          Borrar
        </TeclaPin>
        <TeclaPin onClick={() => teclear('0')} disabled={enviando}>
          0
        </TeclaPin>
        <TeclaPin
          onClick={() => setPin((actual) => actual.slice(0, -1))}
          disabled={enviando}
          secundaria
          etiqueta="Borrar último dígito"
        >
          ⌫
        </TeclaPin>
      </div>
    </section>
  );
}

interface PropsTecla {
  children: string;
  onClick: () => void;
  disabled: boolean;
  secundaria?: boolean;
  etiqueta?: string;
}

function TeclaPin({ children, onClick, disabled, secundaria = false, etiqueta }: PropsTecla) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={etiqueta}
      className={`h-20 w-20 rounded-2xl font-semibold shadow-sm transition select-none focus:outline-none focus-visible:ring-4 focus-visible:ring-orange-300 active:scale-95 disabled:opacity-50 ${
        secundaria
          ? 'bg-stone-100 text-base text-stone-700 hover:bg-stone-200'
          : 'border-2 border-orange-200 bg-white text-3xl hover:border-orange-500'
      }`}
    >
      {children}
    </button>
  );
}
