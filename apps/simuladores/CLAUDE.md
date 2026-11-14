# apps/simuladores — Banco y WhatsApp simulados

## Qué es

SPA en React + Vite + Tailwind que simula los **sistemas externos** con los que habla el restaurante: el banco que recibe transferencias y WhatsApp para avisar al cliente. Se despliega en Cloudflare Pages como `serviceagent-simuladores`.

| Ruta        | Simula                                    | Historia                        |
| ----------- | ----------------------------------------- | ------------------------------- |
| `/banco`    | App del banco: transferir y ver el historial | US-24 ([D70](../../docs/decisiones.md)) |
| `/whatsapp` | Bandeja de mensajes del cliente           | Pendiente: se define en US-28   |

## Cómo está organizado

- `src/main.tsx`: monta `<App />` dentro de `BrowserRouter`.
- `src/App.tsx`: barra con la etiqueta "SIMULADOR EXTERNO" y las rutas (`/` redirige a `/banco`).
- `src/pages/Banco.tsx`: formulario (CLABE destino, monto en pesos y referencia), botón Transferir, comprobante y tabla "Transferencias enviadas". Solo pinta: la lógica está en `lib/banco.ts`.
- `src/lib/banco.ts`: lógica pura de `/banco`. `pesosACentavos` (texto a centavos sin punto flotante), `leerFormulario` (valida con los esquemas de `@serviceagent/shared` y dice qué corregir en cada campo), `aplicarErrorSimulado` (`monto_distinto`: un peso menos; `referencia_equivocada`: cambia el último carácter), el historial en `localStorage` (`leerHistorial`, `agregarAlHistorial`, `almacenDelNavegador`; hasta 50, lo dañado se descarta) y los textos (`formatearFecha` en America/Chihuahua, `formatearClabe`, `mensajeDeError`).
- `src/lib/api.ts`: `enviarApi` (`POST` con JSON a `VITE_API_URL` y respuesta validada con zod) y `ErrorApi`.
- `src/pages/WhatsApp.tsx`: placeholder; lo reemplaza US-28.
- `test/`: tests de Vitest de la lógica (`banco.test.ts`), sin navegador.

## Convenciones de esta área

- Estilo visual **distinto a propósito** de `apps/web` (fondo `slate` oscuro, fuente monoespaciada): en la demo debe verse como "otro sistema".
- Se comunican con el restaurante solo como lo haría el servicio real, para poder cambiarlos por servicios reales sin tocar el resto (D5). El banco no llama al webhook desde el navegador: le pide la transferencia a su servidor (`POST /banco-simulado/transferencias`, en el Worker de la API), que es quien firma y manda el aviso a `POST /webhooks/banco` (D70).
- El banco no calcula ni valida nada del pedido: manda la CLABE, el monto y la referencia que escribió el cliente. Montos en centavos al salir de la pantalla.
- La página no tiene lógica: lo que se pueda probar sin navegador va en `src/lib/` con su test.
- Variables de entorno solo con prefijo `VITE_` y nunca secretas.

## Cómo probar

```bash
pnpm --filter @serviceagent/simuladores dev        # http://localhost:5174
pnpm --filter @serviceagent/simuladores test       # Vitest
pnpm --filter @serviceagent/simuladores typecheck
pnpm --filter @serviceagent/simuladores build
```

Para transferir en local hace falta la API corriendo con `BANCO_WEBHOOK_SECRET` y con `http://localhost:5174` en `CORS_ORIGINS` ([docs/despliegue.md](../../docs/despliegue.md)).

## Reglas que aplican

- [docs/negocio.md → Pagos](../../docs/negocio.md#pagos): webhook con firma HMAC, conciliación y casos borde.
- [docs/decisiones.md](../../docs/decisiones.md): D5, D70 y pendiente de proveedor real de WhatsApp (US-50).
- [docs/despliegue.md](../../docs/despliegue.md): variables `VITE_*` y despliegue en Pages.
