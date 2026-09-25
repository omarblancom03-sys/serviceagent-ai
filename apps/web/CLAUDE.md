# apps/web — Frontend del restaurante

## Qué es

SPA en React + Vite + Tailwind + React Router para clientes y empleados. Se despliega en Cloudflare Pages como `serviceagent-web`.

| Ruta      | Para quién     | Historia                        |
| --------- | -------------- | ------------------------------- |
| `/pedir`  | Cliente (chat) | Pendiente: se define en US-09   |
| `/cocina` | Rol `cocina`   | Pendiente: se define en US-10   |
| `/caja`   | Rol `caja`     | Pendiente: se define en US-20   |
| `/admin`  | Rol `admin`    | Pendiente: se define en US-05   |
| `/login`  | Empleados      | Pendiente: se define en US-04   |

## Cómo está organizado

- `src/main.tsx`: monta `<App />` dentro de `BrowserRouter`.
- `src/App.tsx`: barra de navegación y tabla de rutas (`/` redirige a `/pedir`).
- `src/pages/`: una página por ruta. Hoy todas usan `PaginaPlaceholder`; cada historia reemplaza la suya con la pantalla real.
- `src/index.css`: solo `@import 'tailwindcss'` (Tailwind 4, sin archivo de configuración).

## Convenciones de esta área

- Componentes en `PascalCase`, un componente principal por archivo; textos visibles en español.
- Estilos con clases de Tailwind. Identidad del restaurante: tonos naranja/stone.
- Esquemas y tipos de la API se importan de `@serviceagent/shared`; no se redefinen aquí.
- Nunca se calculan montos en el frontend: se muestran los que manda la API.
- Protección de rutas por rol: pendiente: se define en US-04.
- Variables de entorno solo con prefijo `VITE_` y nunca secretas (terminan en el navegador).

## Cómo probar

```bash
pnpm --filter @serviceagent/web dev         # http://localhost:5173
pnpm --filter @serviceagent/web typecheck
pnpm --filter @serviceagent/web build
```

Tests de componentes: pendiente: se define en US-04 (hoy `vitest run --passWithNoTests`).

## Reglas que aplican

- [Reglas de oro](../../CLAUDE.md#reglas-de-oro) del raíz.
- [docs/negocio.md](../../docs/negocio.md): estados del pedido (botones de cocina y caja) y autenticación por PIN.
- [docs/despliegue.md](../../docs/despliegue.md): variables `VITE_*` y despliegue en Pages.
- [docs/decisiones.md](../../docs/decisiones.md): pendiente de Realtime con auth propia (US-04 / US-10).
