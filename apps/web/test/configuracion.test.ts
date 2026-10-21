import type { ConfiguracionRestaurante } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../src/lib/api';
import {
  DESCRIPCION_MODO_PAGO,
  MODOS_EN_PANTALLA,
  mensajeErrorConfiguracion,
  textoUltimoCambio,
} from '../src/lib/configuracion';

const configuracion = (
  extra: Partial<ConfiguracionRestaurante> = {},
): ConfiguracionRestaurante => ({
  modoPago: 'al_recoger',
  actualizadoEn: '2026-10-21T07:05:00.000Z',
  actualizadoPor: null,
  ...extra,
});

describe('modo de pago en /admin (US-22)', () => {
  it('muestra los dos modos, primero el de pago al recoger', () => {
    expect(MODOS_EN_PANTALLA).toEqual(['al_recoger', 'transferencia']);
    expect(DESCRIPCION_MODO_PAGO.al_recoger.detalle).toMatch(/efectivo o con tarjeta/);
    expect(DESCRIPCION_MODO_PAGO.transferencia.detalle).toMatch(/espera el pago/);
  });

  it('dice quién hizo el último cambio y cuándo, en la hora del restaurante', () => {
    // 07:05 UTC es la 01:05 en Chihuahua (UTC-6).
    expect(textoUltimoCambio(configuracion({ actualizadoPor: 'Admin de prueba' }))).toBe(
      'Lo cambió Admin de prueba el 21/10 a las 01:05.',
    );
  });

  it('si nadie lo ha cambiado, lo dice', () => {
    expect(textoUltimoCambio(configuracion())).toBe('Configuración inicial: nadie la ha cambiado.');
  });

  it('errores sin códigos técnicos: 403, al leer y al guardar', () => {
    expect(mensajeErrorConfiguracion(new ErrorApi(403, null), 'guardar')).toBe(
      'Solo el administrador puede ver y cambiar el modo de pago.',
    );
    expect(mensajeErrorConfiguracion(new ErrorApi(500, null), 'leer')).toBe(
      'No se pudo cargar el modo de pago. Intenta de nuevo.',
    );
    expect(mensajeErrorConfiguracion(new TypeError('Failed to fetch'), 'guardar')).toBe(
      'No se pudo cambiar el modo de pago. Intenta de nuevo; el modo sigue como estaba.',
    );
  });
});
