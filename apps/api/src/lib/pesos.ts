const formatoPesos = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Convierte centavos a texto para leer o mostrar: 40300 → "$403.00".
 * Es solo formato: la API sigue calculando y devolviendo centavos (D7), y el agente lee este texto
 * para no convertir montos nunca.
 * Lanza un error si no recibe un entero de centavos no negativo: un decimal, `NaN` o un negativo
 * es un error de cálculo antes de llegar aquí, y no debe llegar al cliente como si fuera un precio.
 */
export function formatearPesos(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) {
    throw new Error(`Monto inválido en centavos: ${centavos}`);
  }
  return formatoPesos.format(centavos / 100);
}
