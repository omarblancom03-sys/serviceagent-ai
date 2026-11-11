# Evaluación de la información del restaurante

Resultado de la última vez que se corrieron las preguntas de [`preguntasInfo.json`](./preguntasInfo.json) contra `info_restaurante` (US-17: el tema correcto debe venir entre los resultados en todas). Se reemplaza completo en cada corrida; se vuelve a correr si cambia el modelo, el umbral, el margen o un texto del seed ([D62](../../../docs/decisiones.md)). Script: [`evaluarInfo.ts`](./evaluarInfo.ts).

- **Fecha:** 11 de noviembre de 2026
- **Modelo:** `@cf/baai/bge-m3` (Workers AI), umbral 0.45 y margen 0.08 contra la mejor
- **Datos:** los 9 temas del seed `05_info_restaurante.sql` en `serviceagent-dev`, API local con `wrangler dev` y el binding `AI` remoto
- **Resultado:** **20 de 20** con su tema (16 solo su tema). Lo que la información no tiene: 2 de 5 sin resultados.

| #   | Pregunta                                   | Tema            | Lo que devolvió (en orden)            |
| --- | ------------------------------------------ | --------------- | ------------------------------------- |
| 1   | ¿A qué hora abren?                         | horario         | horario                               |
| 2   | ¿Hasta qué hora están abiertos el domingo? | horario         | horario                               |
| 3   | ¿Abren hoy?                                | horario         | horario                               |
| 4   | ¿Dónde están?                              | direccion       | direccion                             |
| 5   | ¿Cuál es la dirección?                     | direccion       | direccion                             |
| 6   | ¿Cómo llego al restaurante?                | direccion       | reservaciones, direccion, domicilio   |
| 7   | ¿Me pasas su número de teléfono?           | telefono        | telefono                              |
| 8   | ¿A qué número les llamo?                   | telefono        | telefono                              |
| 9   | ¿Tienen estacionamiento?                   | estacionamiento | estacionamiento                       |
| 10  | ¿Dónde me estaciono?                       | estacionamiento | estacionamiento                       |
| 11  | ¿Aceptan tarjeta?                          | formas_pago     | formas_pago                           |
| 12  | ¿Puedo pagar en efectivo?                  | formas_pago     | formas_pago                           |
| 13  | Soy alérgico al cacahuate                  | alergenos       | alergenos                             |
| 14  | ¿Tienen opciones sin gluten?               | alergenos       | alergenos, domicilio                  |
| 15  | ¿Puedo reservar una mesa para 6?           | reservaciones   | reservaciones                         |
| 16  | ¿Hacen reservaciones?                      | reservaciones   | reservaciones                         |
| 17  | ¿Hay wifi?                                 | wifi            | wifi                                  |
| 18  | ¿Cuál es la contraseña del internet?       | wifi            | wifi                                  |
| 19  | ¿Tienen servicio a domicilio?              | domicilio       | domicilio                             |
| 20  | ¿Me lo pueden llevar a mi casa?            | domicilio       | domicilio, reservaciones, formas_pago |

**Lo que la información no tiene** (no cuenta para la meta): "¿Cuánto cuesta una hamburguesa?" y "¿Venden cerveza?" no devolvieron nada; "¿Aceptan mascotas?" devolvió domicilio, "¿Tienen área de juegos para niños?" estacionamiento y "¿Facturan?" reservaciones y formas de pago. En esos casos el agente debe ver que el texto no responde la pregunta y decir que no tiene el dato.

**Observaciones:**

- **Por qué umbral y margen:** con textos cortos un umbral fijo no separa respuestas de no-respuestas. En la primera corrida (10-nov) las respuestas correctas quedaron entre 0.47 ("¿Dónde están?") y 0.74, y "¿Tienen servicio a domicilio?", que entonces no tenía tema, llegó a 0.54. El margen de 0.08 contra la mejor quita las entradas de relleno: sin él, "Reservaciones" salía segunda en casi todo.
- **Títulos y textos que buscan:** "¿Cómo llego?" encontraba primero el wifi. Se arregló poniendo "cómo llegar" en el título y en el texto de la dirección. Al quitar el teléfono de reservaciones y agregar domicilio (los dos dicen "en el restaurante"), la dirección volvió a perderse hasta que su texto dijo "Para llegar al restaurante".
- **Tiempos:** la primera consulta con la tabla vacía indexa las 9 entradas en ~2.4 s; después, cada consulta tarda de 0.4 a 1.5 s.
