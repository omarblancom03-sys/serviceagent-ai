import { ListadoMenu } from '../components/ListadoMenu';
import { ModoPagoAdmin } from '../components/ModoPagoAdmin';

/**
 * Panel de administración: el modo de pago del restaurante (US-22) y el menú (US-05) con resumen,
 * tiempos de preparación y errores detallados.
 */
export function AdminMenu() {
  return (
    <>
      <ModoPagoAdmin />
      <ListadoMenu modo="admin" />
    </>
  );
}
