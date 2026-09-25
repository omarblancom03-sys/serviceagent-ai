# apps/simuladores — Banco y WhatsApp simulados

## Qué es

SPA en React + Vite + Tailwind que simula los **sistemas externos** con los que habla el restaurante: el banco que recibe transferencias y WhatsApp para avisar al cliente. Se despliega en Cloudflare Pages como `serviceagent-simuladores`.

| Ruta        | Simula                                    | Historia                        |
| ----------- | ----------------------------------------- | ------------------------------- |
| `/banco`    | App del banco que paga y manda el webhook | Pendiente: se define en US-24   |
| `/whatsapp` | Bandeja de mensajes del cliente           | Pendiente: se define en US-28   |

## Cómo está organizado

- `src/main.tsx`: monta `<App />` dentro de `BrowserRouter`.
- `src/App.tsx`: barra con la etiqueta "SIMULADOR EXTERNO" y las rutas (`/` redirige a `/banco`).
- `src/pages/Banco.tsx` y `src/pages/WhatsApp.tsx`: placeholders; cada historia reemplaza el suyo.

## Convenciones de esta área

- Estilo visual **distinto a propósito** de `apps/web` (fondo `slate` oscuro, fuente monoespaciada): en la demo debe verse como "otro sistema".
- Se comunican con la API solo como lo haría el servicio real (por ejemplo, el banco llama al webhook firmado), para poder cambiarlos por servicios reales sin tocar el resto (D5).
- Variables de entorno solo con prefijo `VITE_` y nunca secretas.

## Cómo probar

```bash
pnpm --filter @serviceagent/simuladores dev        # http://localhost:5174
pnpm --filter @serviceagent/simuladores typecheck
pnpm --filter @serviceagent/simuladores build
```

Tests: pendiente: se define en US-24 (hoy `vitest run --passWithNoTests`).

## Reglas que aplican

- [docs/negocio.md → Pagos](../../docs/negocio.md#pagos): webhook con firma HMAC, conciliación y casos borde.
- [docs/decisiones.md](../../docs/decisiones.md): D5 y pendiente de proveedor real de WhatsApp (US-50).
- [docs/despliegue.md](../../docs/despliegue.md): variables `VITE_*` y despliegue en Pages.
