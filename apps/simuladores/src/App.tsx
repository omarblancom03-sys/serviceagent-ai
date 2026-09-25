import { Navigate, NavLink, Route, Routes } from 'react-router';
import { Banco } from './pages/Banco';
import { WhatsApp } from './pages/WhatsApp';

/**
 * Simuladores de sistemas externos (docs/decisiones.md, D5).
 * Tienen un estilo visual distinto a apps/web a propósito: en la demo deben verse
 * como "otro sistema", no como parte del restaurante.
 */
export function App() {
  return (
    <div className="min-h-screen bg-slate-950 font-mono text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3 text-sm">
          <span className="rounded bg-sky-500/20 px-2 py-0.5 text-sky-300">SIMULADOR EXTERNO</span>
          <NavLink
            to="/banco"
            className={({ isActive }) => (isActive ? 'text-sky-300' : 'text-slate-400')}
          >
            Banco
          </NavLink>
          <NavLink
            to="/whatsapp"
            className={({ isActive }) => (isActive ? 'text-emerald-300' : 'text-slate-400')}
          >
            WhatsApp
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/banco" replace />} />
          <Route path="/banco" element={<Banco />} />
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="*" element={<h1 className="text-2xl">Página no encontrada</h1>} />
        </Routes>
      </main>
    </div>
  );
}
