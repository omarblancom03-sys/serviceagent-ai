# Cómo se documenta este repo

La documentación está dividida para que cada sesión de IA cargue solo lo que necesita (decisión D11 en [decisiones.md](decisiones.md)):

| Nivel            | Archivo                                   | Cuándo se carga en Claude Code                                      |
| ---------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Raíz             | `/CLAUDE.md`                              | Siempre, al iniciar la sesión                                       |
| Área             | `apps/*/CLAUDE.md`, `supabase/CLAUDE.md`… | Cuando Claude lee un archivo de esa carpeta                         |
| Tema transversal | `docs/*.md`                               | Solo cuando Claude lo abre siguiendo el índice del `CLAUDE.md` raíz |

Por eso los `docs/` se enlazan con links normales y **no** con `@docs/...`: un `@import` los cargaría en cada sesión y se pierde el ahorro.

Con otra IA (ChatGPT, Gemini, Copilot…): pega el `CLAUDE.md` raíz y los archivos del índice que apliquen a la tarea.

## Reglas

1. **Fuente única:** cada dato vive en UN archivo; los demás enlazan, no copian.
2. Se describe cómo **ES** el sistema, nunca bitácoras ("hoy se hizo").
3. **Límites:** raíz ≤120 líneas, `CLAUDE.md` de área ≤80, archivos de `docs/` ≤200. Si se pasa, se resume.
4. **Área nueva** (carpeta nueva en `apps/`, `packages/` u otra de primer nivel): se crea su `CLAUDE.md` con la plantilla de abajo y se agrega al índice del raíz en el mismo PR.
5. **Tema nuevo transversal** (no pertenece a un área): nuevo archivo en `docs/` + entrada en el índice del raíz.
6. **Decisiones:** solo se AGREGAN filas en [decisiones.md](decisiones.md); una decisión reemplazada se marca "Reemplazada por Dxx", no se borra.
7. Lo que está **en progreso** vive en Trello, no en los md. Lo **terminado** va en `CHANGELOG.md`.
8. Toda historia se cierra con **`/cerrar-historia US-XX`** antes de abrir el PR.

## Plantilla de `CLAUDE.md` de área

```markdown
# <carpeta>/ — <nombre corto>

## Qué es

## Cómo está organizado

## Convenciones de esta área

## Cómo probar

## Reglas que aplican

<!-- Solo enlaces a docs/ o al CLAUDE.md raíz, sin copiar el texto. -->
```

Se llena solo con lo que existe en el repo. Si una sección aún no aplica: "Pendiente: se define en US-XX".

## `/cerrar-historia`

Skill del proyecto en `.claude/skills/cerrar-historia/SKILL.md`. Se invoca a mano (`/cerrar-historia US-07`); Claude no lo lanza solo porque termina en un commit. Revisa `git diff main...HEAD`, actualiza solo la documentación de las áreas que cambiaron, agrega una línea en "Sin publicar" de `CHANGELOG.md` y pide confirmación antes de commitear.

Los skills reemplazan a los antiguos commands de `.claude/commands/` ([documentación oficial](https://code.claude.com/docs/en/slash-commands)).

## Archivos de secretos y Claude Code

`.claude/settings.json` (compartido, versionado) niega a Claude leer `.env`, `.env.*` (excepto `.env.example`), `.dev.vars`, `.dev.vars.*`, `*.pem`, `*.key` y carpetas `secrets/`, en cualquier nivel del repo.

Límite ([documentación oficial](https://code.claude.com/docs/en/permissions)): las reglas `deny` de `Read` bloquean las herramientas de archivos de Claude y comandos como `cat`, `head` o `sed`, pero **no** un `grep -r` sobre la carpeta ni un script que abra el archivo por su cuenta. No sustituyen la regla de oro: los secretos nunca entran al repo.

Ajustes personales de Claude Code: `.claude/settings.local.json` (ignorado por Git).
