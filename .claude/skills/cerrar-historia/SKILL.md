---
name: cerrar-historia
description: Cierra una historia de usuario (US-XX) actualizando solo la documentación de las áreas que cambiaron en la rama, antes de abrir el Pull Request.
argument-hint: US-XX
disable-model-invocation: true
---

Cierra la historia $ARGUMENTS. Lee /docs/documentacion.md. Revisa git diff main...HEAD --stat. Actualiza SOLO la documentación de las áreas que cambiaron en esta rama, siguiendo las reglas de /docs/documentacion.md (crear CLAUDE.md de área o archivo en docs/ si aplica, agregar decisiones, actualizar supabase/CLAUDE.md si cambió el esquema, verificar Swagger si cambió la API, una línea en 'Sin publicar' de CHANGELOG.md). Edita y reemplaza lo obsoleto, no agregues al final. Respeta los límites de líneas. Muéstrame los archivos cambiados con una línea de por qué y espera mi confirmación antes de commitear con 'docs(US-XX): actualizar documentación'.
