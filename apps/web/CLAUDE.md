# apps/web — Frontend del restaurante

## Qué es

SPA en React + Vite + Tailwind + React Router para clientes y empleados. Se despliega en Cloudflare Pages como `serviceagent-web`.

| Ruta      | Para quién     | Historia                        |
| --------- | -------------- | ------------------------------- |
| `/pedir`  | Cliente (chat) | Pendiente: se define en US-09   |
| `/cocina` | Rol `cocina` (y `admin`) | Protegida en US-04; pantalla real en US-10 |
| `/caja`   | Rol `caja` (y `admin`) | Protegida en US-04; pantalla real en US-20 |
| `/admin`  | Rol `admin` | Protegida en US-04; pantalla real en US-05 |
| `/login`  | Empleados | US-04: tarjeta de empleado + teclado de PIN |

## Cómo está organizado

- `src/main.tsx`: monta `<App />` dentro de `BrowserRouter` y `SesionProvider`.
- `src/App.tsx`: barra de navegación (solo pantallas permitidas, nombre del empleado y **Cerrar sesión**) y tabla de rutas (`/` redirige a `/pedir`).
- `src/pages/`: una página por ruta. `Login.tsx` es real; las demás usan `PaginaPlaceholder` hasta que su historia las reemplace.
- `src/auth/`: sesión del empleado.
  - `SesionContext.tsx`: `useSesion()` con `sesion`, `iniciarSesion`, `cerrarSesion` y `pedirConSesion`.
  - `RutaProtegida.tsx`: guarda por rol de cada pantalla interna.
  - `permisos.ts`: `PANTALLAS_EMPLEADO` (ruta → roles), `puedeVer`, `pantallaInicial`, `destinoTrasLogin`.
  - `token.ts` y `mensajes.ts`: lógica pura (leer el JWT, guardar la sesión, textos de error del login).
- `src/lib/api.ts`: `pedirApi(ruta, esquema, opciones)` llama a `VITE_API_URL`, valida la respuesta con zod y lanza `ErrorApi` si no es 2xx.
- `src/index.css`: solo `@import 'tailwindcss'` (Tailwind 4, sin archivo de configuración).

## Convenciones de esta área

- Componentes en `PascalCase`, un componente principal por archivo; textos visibles en español.
- Estilos con clases de Tailwind. Identidad del restaurante: tonos naranja/stone.
- Esquemas y tipos de la API se importan de `@serviceagent/shared`; no se redefinen aquí.
- Nunca se calculan montos en el frontend: se muestran los que manda la API.
- **Pantalla interna nueva:** se agrega a `PANTALLAS_EMPLEADO` con sus roles; `App.tsx` la envuelve en `RutaProtegida` y la muestra en el menú solo a quien puede verla. `admin` entra a todo.
- Las guardas solo ordenan la navegación; la seguridad real está en la API (`requiereRol`). Nunca se oculta un dato sensible solo en el frontend.
- **Llamadas con sesión:** siempre con `pedirConSesion` de `useSesion()`. Agrega el token y, ante un 401, cierra la sesión (vencida o inválida). Sin sesión: `pedirApi`.
- **Sesión:** en `localStorage` (`serviceagent.sesion`) se guardan el token y los datos públicos del empleado (`id`, `nombre`, `rol`) que devuelve `POST /auth/login`. Al cargar la app se descarta si venció o no coincide con el token, y se confirma con `GET /auth/sesion`. Se cierra sola al llegar a `exp`.
- El rol se lee del token (`sesion.payload.rol`), no de los datos guardados del empleado.
- Variables de entorno solo con prefijo `VITE_` y nunca secretas (terminan en el navegador).

## Cómo probar

```bash
pnpm --filter @serviceagent/web dev         # http://localhost:5173
pnpm --filter @serviceagent/web typecheck
pnpm --filter @serviceagent/web build
pnpm --filter @serviceagent/web test        # Vitest (test/*.test.ts)
```

- **Tests:** solo lógica pura en `test/` (token, permisos, mensajes), sin DOM ni dependencias extra.
- **Probar el login a mano:** levanta la API con su `.dev.vars` (ver [apps/api/CLAUDE.md](../api/CLAUDE.md)) y la web. Luego entra a `/login` con los empleados de prueba de [supabase/CLAUDE.md](../../supabase/CLAUDE.md#empleados-de-prueba-solo-desarrollo).

## Reglas que aplican

- [Reglas de oro](../../CLAUDE.md#reglas-de-oro) del raíz.
- [docs/negocio.md](../../docs/negocio.md): estados del pedido (botones de cocina y caja) y autenticación por PIN (roles, bloqueo, duración del JWT).
- [docs/despliegue.md](../../docs/despliegue.md): variables `VITE_*` y despliegue en Pages.
- [docs/decisiones.md](../../docs/decisiones.md): D9, D12 (JWT propio; Realtime solo como señal).
