import type { Rol } from '@serviceagent/shared';

export interface PantallaEmpleado {
  path: string;
  titulo: string;
  /** Roles que pueden entrar. `admin` entra a todas aunque no aparezca. */
  roles: readonly Rol[];
}

/** Pantallas internas del restaurante (docs/negocio.md → Autenticación y roles). */
export const PANTALLAS_EMPLEADO: readonly PantallaEmpleado[] = [
  { path: '/cocina', titulo: 'Cocina', roles: ['cocina'] },
  { path: '/caja', titulo: 'Caja', roles: ['caja'] },
  { path: '/admin', titulo: 'Administración', roles: ['admin'] },
];

export const NOMBRE_ROL: Record<Rol, string> = {
  cocina: 'Cocina',
  caja: 'Caja',
  admin: 'Administración',
};

const PANTALLA_INICIAL: Record<Rol, string> = {
  cocina: '/cocina',
  caja: '/caja',
  admin: '/admin',
};

/** `admin` ve todo; los demás, solo las pantallas de su rol. */
export function puedeVer(rol: Rol, roles: readonly Rol[]): boolean {
  return rol === 'admin' || roles.includes(rol);
}

export function pantallaInicial(rol: Rol): string {
  return PANTALLA_INICIAL[rol];
}

/**
 * A dónde ir después de entrar: a la pantalla que el empleado intentaba abrir si tiene permiso,
 * o a la de su rol.
 */
export function destinoTrasLogin(rol: Rol, desde?: string): string {
  const pantalla = PANTALLAS_EMPLEADO.find((p) => p.path === desde);
  return pantalla && puedeVer(rol, pantalla.roles) ? pantalla.path : pantallaInicial(rol);
}
