# Evaluación de la búsqueda semántica

Resultado de la última vez que se corrió [`evaluarBusqueda.ts`](./evaluarBusqueda.ts) con las preguntas de [`preguntasBusqueda.json`](./preguntasBusqueda.json) (criterio 5 de US-16: el platillo correcto en el top 3 en al menos 18 de 20). Se reemplaza completo en cada corrida; se vuelve a correr si cambia el modelo, el umbral o el texto que se indexa ([D50](../../../docs/decisiones.md)).

- **Fecha:** 20 de octubre de 2026
- **Modelo:** `@cf/baai/bge-m3` (Workers AI), umbral de similitud 0.47
- **Datos:** menú de `serviceagent-dev` (95 platillos visibles), API local con `wrangler dev` y el binding `AI` remoto
- **Resultado:** **19 de 20** en el top 3 (meta: 18). Lo que el menú no tiene: 4 de 5 sin resultados.

| #   | Pregunta                                 | Lugar    | Lo que devolvió (en orden)                                                                                         |
| --- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | algo picoso con pollo                    | 1        | Tiras de pollo, Hamburguesa de Pollo, Ensalada Granero, Boneless, Fajitas de pollo infantil                        |
| 2   | algo picoso con camarones                | 3        | Camarones Empanizados, Camarones al Coco, **Camarones a la Diabla**, Camarones Fiesta, Camarones al Ajillo         |
| 3   | unas costillas en salsa barbecue         | 1        | Costillas BBQ 450 gr, Costillas Chihuahua, Costillas 450 gr, Costillas a la Diabla, Villalba                       |
| 4   | una hamburguesa con piña                 | 1        | Hamburguesa Hawaiana, Hamburguesa Granero, Hamburguesa de Pollo, Hamburguesa Delicias, Hamburguesa Algodoneros     |
| 5   | una hamburguesa de doble carne           | 1        | Hamburguesa Algodoneros, Hamburguesa Granero, Hamburguesa de Pollo, Hamburguesa Hawaiana, Hamburguesa Delicias     |
| 6   | camarones envueltos en tocino            | 1        | Camarones Fiesta, Camarones al Coco, Camarones Empanizados, Camarones al Ajillo, Camarones a la Crema              |
| 7   | agua de arroz                            | 1        | Horchata                                                                                                           |
| 8   | una chela bien fría                      | no salió | (nada)                                                                                                             |
| 9   | tacos de carne con chorizo y champiñones | 1        | Tacos Rancheros, Taquiza Ranchera, Taquiza Sirloin, Tacos capeados, Taquiza del Mar                                |
| 10  | una ensalada con pollo                   | 1        | Ensalada Granero, Tiras de pollo, Hamburguesa de Pollo, Ensalada Natural, Ensalada Rancho                          |
| 11  | una sopa caliente de pollo               | 2        | Tiras de pollo, **Caldo Granero**, Hamburguesa de Pollo, Ensalada Granero, Boneless                                |
| 12  | pescado empanizado                       | 1        | Filete de pescado empanizado, Filete de pescado infantil, Camarones Empanizados, Tiras de pollo, Camarones al Coco |
| 13  | algo de comer para un niño con pollo     | 1        | Fajitas de pollo infantil, Boneless, Caldito Granero, Fajitas de pollo, Hamburguesa de Pollo                       |
| 14  | mariscos frescos con pulpo               | 1        | Torre de mariscos                                                                                                  |
| 15  | fajitas mixtas de res, pollo y camarón   | 1        | Fajitas Trío, Fajitas de pollo, Fajitas de pollo infantil, Fajitas de arrachera, Parrillada Familiar               |
| 16  | carne seca con chile colorado            | 1        | Guisado Abigeo, Orden de chiles, Costillas Chihuahua                                                               |
| 17  | una papa rellena de arrachera            | 1        | Papa con Arrachera, Fajitas de arrachera infantil, Fajitas de arrachera, Tacos de Arrachera, Arrachera 450 gr      |
| 18  | algo dulce de postre con helado          | 1        | Brownies con nieve, Cheesecake con nieve, Tarta de manzana con nieve, Postre del día, Hamburguesa Delicias         |
| 19  | queso derretido para botanear            | 1        | Queso fundido                                                                                                      |
| 20  | un corte de carne de res grande          | 1        | Rib Eye 450 gr, Cowboy 450 gr, Sirloin 450 gr, Taco Delicias, T-Bone 450 gr                                        |

**Lo que el menú no tiene** (no cuenta para la meta): "ramen", "lasaña", "pad thai" y "croissant" no devolvieron nada; "sushi de salmón" devolvió la Torre de mariscos, lo más parecido del menú (similitud 0.49), y el agente debe decir que sushi no hay.

**Observaciones:**

- **Calibración del umbral:** con el umbral en 0 (todo pasa) el resultado fue el mismo, 19 de 20. El platillo correcto más bajo quedó en 0.48 ("queso derretido" → Queso fundido) y lo que el menú no tiene, entre 0.41 y 0.45, salvo sushi (0.49). Con 0.47 se conservan los 19 aciertos y se descarta casi todo lo que no hay; con 0.49 se perdía "queso derretido".
- **La que falla:** "chela" es caló y el modelo no la relaciona con cerveza (el mejor resultado fue 0.47, con un platillo sin relación). Con el umbral no devuelve nada en vez de inventar; se arregla con un sinónimo "chela" en las cervezas, decisión de menú del PO.
- **"Picoso":** el menú no dice qué platillos pican. "Camarones a la Diabla" salió 3.º en "algo picoso con camarones" porque su descripción dice "chipotle", no "picante".
- **Tiempos:** la primera búsqueda con la tabla vacía indexa los 95 platillos en ~5.4 s (lotes en paralelo); después, cada búsqueda tarda de 1.0 a 1.6 s.
