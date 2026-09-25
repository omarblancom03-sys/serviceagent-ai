import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router';
import { NOMBRE_ROL, PANTALLAS_EMPLEADO, puedeVer } from './auth/permisos';
import { RutaProtegida } from './auth/RutaProtegida';
import { useSesion } from './auth/SesionContext';
import { Login } from './pages/Login';
import { PaginaPlaceholder } from './pages/PaginaPlaceholder';

const claseEnlace = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'font-semibold text-orange-700' : 'text-stone-600 hover:text-orange-700';

export function App() {
  const { sesion, cerrarSesion } = useSesion();
  const navigate = useNavigate();
  const rol = sesion?.payload.rol;

  // El menú muestra solo las pantallas que el rol puede abrir.
  const pantallasVisibles = rol ? PANTALLAS_EMPLEADO.filter((p) => puedeVer(rol, p.roles)) : [];

  function salir() {
    cerrarSesion();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-orange-50 text-stone-900">
      <header className="border-b border-orange-200 bg-white">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-bold text-orange-700">ServiceAgent AI</span>
          <NavLink to="/pedir" className={claseEnlace}>
            Pedir
          </NavLink>
          {pantallasVisibles.map((pantalla) => (
            <NavLink key={pantalla.path} to={pantalla.path} className={claseEnlace}>
              {pantalla.titulo}
            </NavLink>
          ))}

          <div className="ml-auto flex items-center gap-3">
            {sesion ? (
              <>
                <span className="text-sm text-stone-600">
                  {sesion.empleado.nombre} · {NOMBRE_ROL[sesion.payload.rol]}
                </span>
                <button
                  type="button"
                  onClick={salir}
                  className="rounded-lg border border-orange-300 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-100"
                >
                  Cerrar sesión
                </button>
              </>
            ) : (
              <NavLink to="/login" className={claseEnlace}>
                Acceso empleados
              </NavLink>
            )}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/pedir" replace />} />
          <Route path="/pedir" element={<PaginaPlaceholder titulo="Pedir" />} />
          <Route path="/login" element={<Login />} />
          {PANTALLAS_EMPLEADO.map((pantalla) => (
            <Route
              key={pantalla.path}
              path={pantalla.path}
              element={
                <RutaProtegida roles={pantalla.roles}>
                  <PaginaPlaceholder titulo={pantalla.titulo} />
                </RutaProtegida>
              }
            />
          ))}
          <Route path="*" element={<PaginaPlaceholder titulo="Página no encontrada" />} />
        </Routes>
      </main>
    </div>
  );
}
