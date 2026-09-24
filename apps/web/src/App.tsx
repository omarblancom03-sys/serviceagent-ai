import { Navigate, NavLink, Route, Routes } from 'react-router';
import { PaginaPlaceholder } from './pages/PaginaPlaceholder';

const rutas = [
  { path: '/pedir', titulo: 'Pedir' },
  { path: '/cocina', titulo: 'Cocina' },
  { path: '/caja', titulo: 'Caja' },
  { path: '/admin', titulo: 'Administración' },
  { path: '/login', titulo: 'Iniciar sesión' },
];

export function App() {
  return (
    <div className="min-h-screen bg-orange-50 text-stone-900">
      <header className="border-b border-orange-200 bg-white">
        <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-bold text-orange-700">ServiceAgent AI</span>
          {rutas.map((ruta) => (
            <NavLink
              key={ruta.path}
              to={ruta.path}
              className={({ isActive }) =>
                isActive ? 'font-semibold text-orange-700' : 'text-stone-600 hover:text-orange-700'
              }
            >
              {ruta.titulo}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/pedir" replace />} />
          {rutas.map((ruta) => (
            <Route
              key={ruta.path}
              path={ruta.path}
              element={<PaginaPlaceholder titulo={ruta.titulo} />}
            />
          ))}
          <Route path="*" element={<PaginaPlaceholder titulo="Página no encontrada" />} />
        </Routes>
      </main>
    </div>
  );
}
