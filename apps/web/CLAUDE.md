# apps/web — Frontend del restaurante

## Qué es

SPA en React + Vite + Tailwind + React Router para clientes y empleados. Se despliega en Cloudflare Pages como `serviceagent-web`.

| Ruta      | Para quién     | Historia                        |
| --------- | -------------- | ------------------------------- |
| `/pedir`  | Cliente (público, sin login) | US-09-P2: chat con el asistente sobre `POST /chat/...`; la conversación se crea al primer mensaje y no se guarda en el navegador (D40) |
| `/menu`   | Cliente (público, sin login) | US-09-P2: el menú de `/admin` sin conteos, tiempos ni errores técnicos; busca también por categoría |
| `/cocina` | Rol `cocina` (y `admin`) | US-10: tickets en cola o preparándose (`GET /cocina/pedidos`), del más antiguo al más nuevo; aparecen solos con la señal de Realtime y se refrescan cada 30 s (D47). US-13: minutos desde que entró a la cola, recalculados cada 15 s; desde 20 min, rojo y "Atrasado" |
| `/caja`   | Rol `caja` (y `admin`) | Protegida en US-04; pantalla real en US-20 |
| `/admin`  | Rol `admin` | US-05: menú de solo lectura (`GET /menu`) con búsqueda y filtro por categoría |
| `/login`  | Empleados | US-04: tarjeta de empleado + teclado de PIN |

## Cómo está organizado

- `src/main.tsx`: monta `<App />` dentro de `BrowserRouter` y `SesionProvider`.
- `src/App.tsx`: barra de navegación (solo pantallas permitidas, nombre del empleado y **Cerrar sesión**) y tabla de rutas (`/` redirige a `/pedir`). `PAGINA_EMPLEADO` dice qué pantalla interna ya tiene página real; las demás muestran `PaginaPlaceholder`. Las rutas públicas (`/pedir`, `/menu`, `/login`) van fuera de `PANTALLAS_EMPLEADO` y sin `RutaProtegida`.
- `src/pages/`: una página por ruta. Reales: `Login.tsx`, `AdminMenu.tsx` (`/admin`), `MenuCliente.tsx` (`/menu`), `PedirChat.tsx` (`/pedir`) y `Cocina.tsx` (`/cocina`); las demás usan `PaginaPlaceholder` hasta que su historia las reemplace.
- `src/components/ListadoMenu.tsx`: el listado del menú que comparten `/admin` y `/menu` (carga, error con **Reintentar**, buscador, selector, tarjetas y extras sueltos). Recibe `modo` y solo lee las opciones de `opcionesVista(modo)`.
- `src/auth/`: sesión del empleado.
  - `SesionContext.tsx`: `useSesion()` con `sesion`, `iniciarSesion`, `cerrarSesion` y `pedirConSesion`.
  - `RutaProtegida.tsx`: guarda por rol de cada pantalla interna.
  - `permisos.ts`: `PANTALLAS_EMPLEADO` (ruta → roles), `puedeVer`, `pantallaInicial`, `destinoTrasLogin`.
  - `token.ts` y `mensajes.ts`: lógica pura (leer el JWT, guardar la sesión, textos de error del login).
- `src/lib/api.ts`: `pedirApi(ruta, esquema, opciones)` llama a `VITE_API_URL`, valida la respuesta con zod y lanza `ErrorApi` si no es 2xx. Si el contrato no coincide, lanza el error de zod (se reconoce por `error.name === 'ZodError'`, porque zod no es dependencia directa de la web).
- `src/lib/menuAdmin.ts`: lógica pura del menú de `/admin` (`formatearPesos` sin `Intl` y con la validación de la API, `normalizarTexto` sin acentos ni puntuación, búsqueda por palabras que ignora una "s" final en las de más de 3 letras, `filtrarMenu` con la opción `buscarPorCategoria`, `resumirMenu`, `formatearHora`).
- `src/lib/menuVista.ts`: qué muestra cada modo del menú (`opcionesVista('admin' | 'cliente')`: banderas, textos y clases), `nombreVarianteVisible` (una sola variante "Único" muestra solo el precio) y `mensajeErrorMenu` (detallado en admin; uno solo y sin códigos para el cliente). Lo que cambie entre modos se agrega aquí, no con condiciones en el componente.
- `src/lib/chat.ts`: lógica pura del chat de `/pedir`: estado y `reducirChat` (fases `listo`, `enviando`, `error`, `terminada`, `limite`, `tope_diario`), `validarTexto` con el esquema de shared y `clasificarErrorChat` (error y paso → fase y aviso, sin códigos HTTP). Solo en `listo` se puede escribir; en `error` la única acción es **Reintentar**, que reenvía `pendiente` sin otra burbuja; en `terminada` y `limite`, **Iniciar otra**.
- **Tope diario del chat:** comparte el 503 `servicio_no_disponible` con una falla de Retell. Se reconoce porque solo ocurre al crear la conversación y el `error` contiene "límite de hoy" (texto de `apps/api/src/routes/chat.ts`); si ese texto cambia, cae al 503 genérico con Reintentar.
- `src/lib/cocina.ts`: lógica pura de `/cocina`: `foliosNuevos` (qué resaltar; nada en la primera carga), `lineaDe` y `separarRenglones` (textos del ticket; extras por unidad con "c/u" si hay más de una; extras sueltos "Aparte"), `estadoConexionDe`, `TEXTO_CONEXION`, `mensajeErrorCocina`, `crearRecargador` (cuándo pedir la lista: señales agrupadas en 400 ms con tope de 2 s desde la primera, una petición a la vez y ponerse al día al reconectar) y los tiempos (refresco cada 30 s, resalte de 15 s; hora en `America/Chihuahua`).
- `src/lib/tiempoCocina.ts` y `src/lib/useAhora.ts`: tiempo de cada ticket (US-13). `MINUTOS_ATRASO` (20, constante en código), `minutosDesde` (con el reloj de la tablet; negativos o fecha inválida → 0), `estaAtrasado` (desde 20 exactos), `textoTiempo` ("12 min", "1 h 05 min") y `clasesTicket`. `useAhora(ms)`: un solo intervalo por pantalla (15 s) y actualiza al volver la pestaña; nunca cuenta ticks.
- `src/lib/senalPedidos.ts`: `escucharSenalPedidos` con `@supabase/supabase-js` y la llave anon (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`): solo escucha el canal `pedidos`, evento `cambio`, sin datos (D12, D47). Sin esas variables, `hayRealtime()` es `false` y la pantalla vive del refresco. Es el único uso de Supabase en la web. Un solo canal para toda la app, que no se cierra: cada pantalla agrega y quita su oyente (cerrarlo al salir y volver enseguida dejaba la pantalla en "Conectando…").
- `src/lib/enlaces.ts`: `separarEnlaces` parte un mensaje en texto y URLs http/https (sin la puntuación final). Los mensajes se pintan como texto de React, nunca con `dangerouslySetInnerHTML`.
- `src/index.css`: solo `@import 'tailwindcss'` (Tailwind 4, sin archivo de configuración).

## Convenciones de esta área

- Componentes en `PascalCase`, un componente principal por archivo; textos visibles en español.
- Estilos con clases de Tailwind. Identidad del restaurante: tonos naranja/stone.
- Esquemas y tipos de la API se importan de `@serviceagent/shared`; no se redefinen aquí.
- Nunca se calculan montos en el frontend: se muestran los que manda la API.
- **Pantalla interna nueva:** se agrega a `PANTALLAS_EMPLEADO` con sus roles; `App.tsx` la envuelve en `RutaProtegida` y la muestra en el menú solo a quien puede verla. `admin` entra a todo.
- Las guardas solo ordenan la navegación; la seguridad real está en la API (`requiereRol`). Nunca se oculta un dato sensible solo en el frontend.
- **Llamadas con sesión:** siempre con `pedirConSesion` de `useSesion()`. Agrega el token y, ante un 401, cierra la sesión (vencida o inválida). Sin sesión: `pedirApi`.
- **Sesión:** en `localStorage` (`serviceagent.sesion`) se guardan el token y los datos públicos del empleado (`id`, `nombre`, `rol`) que devuelve `POST /auth/login`. Al cargar la app se descarta si venció o no coincide con el token, y se confirma con `GET /auth/sesion`: con 401 se cierra; si no, el empleado guardado se reemplaza por el que devuelve la API (el nombre sale de la base, no del JWT). Se cierra sola al llegar a `exp`.
- El rol se lee del token (`sesion.payload.rol`), no de los datos guardados del empleado.
- Variables de entorno solo con prefijo `VITE_` y nunca secretas (terminan en el navegador).

## Cómo probar

```bash
pnpm --filter @serviceagent/web dev         # http://localhost:5173
pnpm --filter @serviceagent/web typecheck
pnpm --filter @serviceagent/web build
pnpm --filter @serviceagent/web test        # Vitest (test/*.test.ts)
```

- **Tests:** solo lógica pura en `test/` (token, permisos, mensajes, menú de admin, vista del menú por modo, estado del chat, enlaces, cocina y tiempo de cocina), sin DOM ni dependencias extra.
- **Probar el login a mano:** levanta la API con su `.dev.vars` (ver [apps/api/CLAUDE.md](../api/CLAUDE.md)) y la web. Luego entra a `/login` con los empleados de prueba de [supabase/CLAUDE.md](../../supabase/CLAUDE.md#empleados-de-prueba-solo-desarrollo).

## Reglas que aplican

- [Reglas de oro](../../CLAUDE.md#reglas-de-oro) del raíz.
- [docs/negocio.md](../../docs/negocio.md): estados del pedido (botones de cocina y caja) y autenticación por PIN (roles, bloqueo, duración del JWT).
- [docs/despliegue.md](../../docs/despliegue.md): variables `VITE_*` y despliegue en Pages.
- [docs/decisiones.md](../../docs/decisiones.md): D9, D12 (JWT propio; Realtime solo como señal).
- Cocina (`/cocina`): D46 (pedidos en cola al confirmar) y D47 (señal de Realtime) en [decisiones.md](../../docs/decisiones.md).
- Menú de `/admin` y `/menu`: D18 (tiempo base), D19 (extras), D20 (agotado) y D23 (usa el `GET /menu` público) en [decisiones.md](../../docs/decisiones.md).
- Chat de `/pedir`: D21, D36 (límite de mensajes), D38 (tope diario), D39 (fallas de Retell) y D40 en [decisiones.md](../../docs/decisiones.md).
