# Reglas de negocio

Reglas **no negociables** del sistema. Aplican a la API, a los frontends, al agente y a la base de datos.

## Flujo principal

```
Cliente (chat web → después voz)
   → Agente en Retell entiende el pedido
   → Consulta el menú con RAG (búsqueda semántica con datos en vivo)
   → Cotiza (el backend calcula el total) y confirma una sola vez
   → Crea el pedido con folio, nombre y teléfono
   → Informa tiempo estimado y método de pago
   → [si es transferencia] Banco simulado → webhook → pedido pagado
   → Pedido aparece en la pantalla de cocina (al confirmar o al pagar, según configuración)
   → Cocina: Empezar → Terminado
   → WhatsApp (simulado) avisa al cliente que puede recoger
   → Caja cobra (si falta) y marca Entregado
```

Fuera de alcance: delivery a domicilio.

## Dinero

- **El modelo de IA NUNCA calcula ni inventa precios, totales ni descuentos.** Todo monto lo calcula el backend con precios de la base de datos.
- Montos en centavos (`integer`) en base de datos y API. Se formatean a pesos solo al mostrar.

## Estados del pedido

```
confirmado → (esperando_pago) → en_cola → preparando → listo → entregado
                                   ↘ cancelado     ↘ expirado
```

| Transición           | Quién la hace                                                         |
| -------------------- | --------------------------------------------------------------------- |
| → confirmado         | Agente (`crear_pedido`), solo tras confirmación explícita del cliente |
| → esperando_pago     | Sistema, si el pago es por transferencia                              |
| → en_cola            | Sistema: al confirmar o al pagar, según `modo_envio_cocina`           |
| en_cola → preparando | Cocina (botón **Empezar**)                                            |
| preparando → listo   | Cocina (botón verde **Terminado**) → dispara aviso por WhatsApp       |
| listo → entregado    | Caja                                                                  |
| → cancelado          | Cliente vía agente (solo antes de `preparando`) o empleado            |
| → expirado           | Sistema, si una transferencia no llega a tiempo                       |

- Cada transición guarda su hora exacta (se usa para el tiempo estimado que aprende).
- `modo_envio_cocina` es configuración del restaurante: `al_confirmar` o `al_pagar`.

## Pagos

- Métodos: transferencia (vía agente), efectivo y tarjeta (en caja).
- Transferencia: referencia única por pedido + CLABE ficticia. El Banco Simulado llama a `POST /webhooks/banco` con **firma HMAC**. El backend concilia por referencia + monto.
- Casos borde obligatorios: monto distinto, referencia inexistente, webhook duplicado (idempotencia), pago tardío de pedido expirado.

## Inventario

- Cada producto, variante y extra tiene receta (ingredientes y cantidad).
- Se descuenta al confirmar el pedido **dentro de una transacción**; se repone al cancelar o expirar.
- Si un ingrediente no alcanza para una porción, el producto se marca agotado automáticamente y el agente deja de ofrecerlo.
- Cocina puede marcar agotado manualmente; no puede cambiar precios ni recetas.

## Tiempo estimado

- v1: tiempo base del platillo más tardado del pedido + carga actual de la cocina.
- v2: el tiempo base se ajusta con el promedio real (Empezar → Terminado) de los últimos pedidos.
- El tiempo prometido se guarda en el pedido y se muestra en el ticket de cocina.

## Autenticación y roles

- Login por **PIN de 4 dígitos** (simula lector de huella): selección de empleado + teclado numérico.
- Roles: `cocina`, `caja`, `admin`. Admin puede ver todo.
- PIN guardado con hash (D13), nunca en texto plano.
- **Bloqueo temporal:** al 5.º PIN incorrecto seguido, el empleado queda bloqueado **15 minutos**, aunque después ponga el PIN correcto. Un acceso correcto reinicia el contador. El bloqueo es por empleado.
- Un empleado inexistente o dado de baja recibe la misma respuesta que un PIN incorrecto.
- **JWT propio** de duración limitada (8 h por defecto, `JWT_EXPIRES_IN`). Lo firma y verifica la API con `JWT_SECRET`, no Supabase. El payload lleva **solo** `sub` (id del empleado), `rol` y `exp`; un token con otros campos se rechaza. El nombre no va en el token: `GET /auth/sesion` busca al empleado en la base y devuelve `{ empleado: { id, nombre, rol }, exp }`. Si ya no existe, está dado de baja o su rol cambió, responde 401 y hay que volver a entrar.
- Cada endpoint interno y cada ruta del frontend se protege por rol. La seguridad real está en la API; las guardas del frontend solo ordenan la navegación.
- Realtime solo avisa "algo cambió", sin datos sensibles; los datos se piden a la API con el JWT (D12).
