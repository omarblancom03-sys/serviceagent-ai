import type { Rol } from '@serviceagent/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { pantallaInicial, puedeVer } from './permisos';
import { useSesion } from './SesionContext';

interface Props {
  roles: readonly Rol[];
  children: ReactNode;
}

/**
 * Muestra `children` solo si hay sesión y el rol puede entrar (`admin` siempre).
 * Sin sesión manda a `/login` recordando a dónde iba; con otro rol, a la pantalla de su rol.
 * Solo ordena la navegación: la seguridad real está en la API (`requiereRol`).
 */
export function RutaProtegida({ roles, children }: Props) {
  const { sesion } = useSesion();
  const { pathname } = useLocation();

  if (!sesion) return <Navigate to="/login" replace state={{ desde: pathname }} />;

  const { rol } = sesion.payload;
  if (!puedeVer(rol, roles)) return <Navigate to={pantallaInicial(rol)} replace />;

  return children;
}
