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

- Login por **PIN** (simula lector de huella): selección de empleado + teclado numérico.
- Roles: `cocina`, `caja`, `admin`. Admin puede ver todo.
- JWT de duración limitada. PIN guardado con hash. Bloqueo temporal tras 5 intentos fallidos.
- Cada endpoint interno y cada ruta del frontend se protege por rol.
