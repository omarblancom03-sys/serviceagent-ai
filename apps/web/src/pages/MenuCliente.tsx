import { ListadoMenu } from '../components/ListadoMenu';

/** Menú público para el cliente (US-09-P2): sin login, sin conteos ni datos internos. */
export function MenuCliente() {
  return <ListadoMenu modo="cliente" />;
}
