const formatoPesos = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Convierte centavos a texto para leer o mostrar: 40300 → "$403.00".
 * Es solo formato: la API sigue calculando y devolviendo centavos (D7), y el agente lee este texto
 * para no convertir montos nunca.
 */
export function formatearPesos(centavos: number): string {
  return formatoPesos.format(centavos / 100);
}
