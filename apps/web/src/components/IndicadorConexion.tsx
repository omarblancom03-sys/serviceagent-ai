import { TEXTO_CONEXION, type EstadoConexion } from '../lib/cocina';

/** Punto verde "En vivo" o ámbar si la pantalla solo se refresca cada 30 s (cocina y caja). */
export function IndicadorConexion({ estado }: { estado: EstadoConexion }) {
  const color = estado === 'en_vivo' ? 'bg-green-500' : 'bg-amber-500';
  return (
    <span className="ml-auto flex items-center gap-2 text-sm text-stone-600">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
      {TEXTO_CONEXION[estado]}
    </span>
  );
}
