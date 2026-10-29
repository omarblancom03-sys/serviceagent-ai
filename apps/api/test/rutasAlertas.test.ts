import {
  ErrorAlertaSchema,
  RespuestaAlertaAtendidaSchema,
  RespuestaAlertasPendientesSchema,
  type Rol,
} from '@serviceagent/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../src/index';
import { firmarToken } from '../src/lib/auth';
import type { Bindings } from '../src/lib/env';
import type { AlertasRepo, NuevaAlerta } from '../src/services/alerta';
import { crearRepoAlertasEnMemoria, repoAlertasQueFalla } from './alertasEnMemoria';

const env = { JWT_SECRET: 'secreto-de-prueba-de-al-menos-32-caracteres' } as Bindings;
const ID_CAJA = '00000000-0000-4000-8000-000000000002';
const ID_ADMIN = '00000000-0000-4000-8000-000000000003';
const ID_OTRO = '00000000-0000-4000-8000-000000000099';
const CHAT_A = 'chat_5f2a9c0e1b7d4e8a9f3c6b2d1e0a';
const CHAT_B = 'chat_b7d4e8a9f3c6b2d1e0a5f2a9c0e1';
const CHAT_C = 'chat_9f3c6b2d1e0a5f2a9c0e1b7d4e8a';

const alerta = (idChat: string, telefono: string, extra: Partial<NuevaAlerta> = {}) => ({
  idChat,
  telefono,
  nombreCliente: 'Ana López',
  folio: null,
  motivo: 'Quiere factura.',
  ...extra,
});

/** Repo con tres alertas creadas en desorden de hora: B (18:00), A (18:05) y C (18:10). */
async function repoConTres() {
  const horas = ['2026-10-26T18:05:00Z', '2026-10-26T18:00:00Z', '2026-10-26T18:10:00Z'];
  const repo = crearRepoAlertasEnMemoria([{ folio: 1024, telefono: '6145550101' }], () => {
    const hora = horas.shift();
    if (!hora) throw new Error('El test creó más alertas de las previstas');
    return new Date(hora);
  });
  await repo.crearAlerta(alerta(CHAT_A, '6145550101', { folio: 1024 }));
  await repo.crearAlerta(alerta(CHAT_B, '6145550102', { nombreCliente: null }));
  await repo.crearAlerta(alerta(CHAT_C, '6145550103'));
  return repo;
}

async function token(rol: Rol, sub = rol === 'admin' ? ID_ADMIN : ID_CAJA, duracion = 3600) {
  return (await firmarToken({ sub, rol }, env.JWT_SECRET, duracion)).token;
}

/** Hace la petición con la sesión indicada: un rol, un token ya firmado o `null` (sin sesión). */
async function pedir(
  repo: AlertasRepo,
  ruta: string,
  sesion: Rol | { token: string } | null,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  if (sesion !== null) {
    const valor = typeof sesion === 'string' ? await token(sesion) : sesion.token;
    headers.set('Authorization', `Bearer ${valor}`);
  }
  return crearApp({ crearRepoAlertas: () => repo }).request(ruta, { ...init, headers }, env);
}

const listar = (repo: AlertasRepo, sesion: Rol | { token: string } | null = 'caja') =>
  pedir(repo, '/caja/alertas', sesion);

const atender = (
  repo: AlertasRepo,
  id: string | number,
  sesion: Rol | { token: string } | null = 'caja',
  init: RequestInit = {},
) => pedir(repo, `/caja/alertas/${id}/atender`, sesion, { method: 'POST', ...init });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /caja/alertas y POST /caja/alertas/{idAlerta}/atender: permisos', () => {
  const rutas = [
    [
      'GET /caja/alertas',
      (repo: AlertasRepo, s: Rol | { token: string } | null) => listar(repo, s),
    ],
    ['POST atender', (repo: AlertasRepo, s: Rol | { token: string } | null) => atender(repo, 1, s)],
  ] as const;

  it.each(rutas)('%s: 401 sin token', async (_, llamar) => {
    const res = await llamar(await repoConTres(), null);
    expect(res.status).toBe(401);
    expect(ErrorAlertaSchema.parse(await res.json()).error).toMatch(/sesión/i);
  });

  it.each(rutas)('%s: 401 con un token vencido', async (_, llamar) => {
    const vencido = await token('caja', ID_CAJA, -60);
    const res = await llamar(await repoConTres(), { token: vencido });
    expect(res.status).toBe(401);
  });

  it.each(rutas)('%s: 403 con rol cocina, sin tocar las alertas', async (_, llamar) => {
    const repo = await repoConTres();
    const res = await llamar(repo, 'cocina');
    expect(res.status).toBe(403);
    expect(ErrorAlertaSchema.parse(await res.json()).error).toMatch(/permiso/i);
    expect(repo.filas.every((f) => f.atendidaEn === null)).toBe(true);
  });

  it.each(['caja', 'admin'] as const)('con rol %s las dos responden 200', async (rol) => {
    const repo = await repoConTres();
    expect((await listar(repo, rol)).status).toBe(200);
    expect((await atender(repo, 1, rol)).status).toBe(200);
  });
});

describe('GET /caja/alertas (US-18 P1-B)', () => {
  it('solo las pendientes, de la más antigua a la más nueva, con teléfono completo', async () => {
    const repo = await repoConTres();
    await atender(repo, 3);

    const res = await listar(repo);
    expect(res.status).toBe(200);
    const { alertas } = RespuestaAlertasPendientesSchema.parse(await res.json());
    expect(alertas).toEqual([
      {
        idAlerta: 2,
        telefono: '6145550102',
        nombre: null,
        folio: null,
        folioTexto: null,
        motivo: 'Quiere factura.',
        creadaEn: '2026-10-26T18:00:00.000Z',
      },
      {
        idAlerta: 1,
        telefono: '6145550101',
        nombre: 'Ana López',
        folio: 1024,
        folioTexto: '#1024',
        motivo: 'Quiere factura.',
        creadaEn: '2026-10-26T18:05:00.000Z',
      },
    ]);
  });

  it('nunca manda el chat_id de Retell', async () => {
    const texto = await (await listar(await repoConTres())).text();
    for (const idChat of [CHAT_A, CHAT_B, CHAT_C]) expect(texto).not.toContain(idChat);
    expect(texto).not.toMatch(/chat/i);
  });

  it('sin alertas pendientes responde la lista vacía', async () => {
    const res = await listar(crearRepoAlertasEnMemoria());
    expect(await res.json()).toEqual({ alertas: [] });
  });

  it('el mismo chat con una atendida y una pendiente: solo trae la pendiente', async () => {
    const repo = crearRepoAlertasEnMemoria();
    await repo.crearAlerta(alerta(CHAT_A, '6145550101', { motivo: 'Primera vez.' }));
    expect((await atender(repo, 1)).status).toBe(200);
    await repo.crearAlerta(alerta(CHAT_A, '6145550101', { motivo: 'Segunda vez.' }));

    const { alertas } = RespuestaAlertasPendientesSchema.parse(await (await listar(repo)).json());
    expect(alertas.map((a) => [a.idAlerta, a.motivo])).toEqual([[2, 'Segunda vez.']]);

    const { atendidaEn, atendidaPor } = repo.filas[0] ?? {};
    expect((await atender(repo, 2, 'admin')).status).toBe(200);
    expect(repo.filas[0]?.atendidaEn).toEqual(atendidaEn);
    expect(repo.filas[0]?.atendidaPor).toBe(atendidaPor);
    expect((await atender(repo, 1)).status).toBe(409);
  });

  it('si falla la lectura responde 500 con un mensaje en español', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await listar(repoAlertasQueFalla);
    expect(res.status).toBe(500);
    expect(ErrorAlertaSchema.parse(await res.json()).error).toMatch(/no se pudieron leer/i);
  });
});

describe('POST /caja/alertas/{idAlerta}/atender (US-18 P1-B)', () => {
  it('200 con la hora; ya no sale en la lista', async () => {
    const repo = await repoConTres();
    const res = await atender(repo, 1);
    expect(res.status).toBe(200);
    expect(RespuestaAlertaAtendidaSchema.parse(await res.json())).toEqual({
      idAlerta: 1,
      atendidaEn: '2026-10-26T18:10:00.000Z',
    });

    const { alertas } = RespuestaAlertasPendientesSchema.parse(await (await listar(repo)).json());
    expect(alertas.map((a) => a.idAlerta)).toEqual([2, 3]);
  });

  it('no trae el teléfono completo', async () => {
    const texto = await (await atender(await repoConTres(), 1)).text();
    expect(texto).not.toContain('6145550101');
    expect(texto).not.toMatch(/telefono/i);
  });

  it('dos veces: la segunda responde 409 y no cambia quién la atendió', async () => {
    const repo = await repoConTres();
    expect((await atender(repo, 1, 'caja')).status).toBe(200);

    const segunda = await atender(repo, 1, 'admin');
    expect(segunda.status).toBe(409);
    expect(ErrorAlertaSchema.parse(await segunda.json()).error).toMatch(/ya atendió/i);
    expect(repo.filas[0]?.atendidaPor).toBe(ID_CAJA);
  });

  it('un id que no existe responde 404', async () => {
    const res = await atender(await repoConTres(), 999);
    expect(res.status).toBe(404);
    expect(ErrorAlertaSchema.parse(await res.json()).error).toMatch(/no encontramos/i);
  });

  it.each(['abc', '0', '-1', '1.5', '1e3', '99999999999', '2147483648'])(
    'id %j responde 400 sin tocar las alertas',
    async (id) => {
      const repo = await repoConTres();
      const res = await atender(repo, id);
      expect(res.status).toBe(400);
      expect(ErrorAlertaSchema.parse(await res.json()).error).toMatch(/entero positivo/i);
      expect(repo.filas.every((f) => f.atendidaEn === null)).toBe(true);
    },
  );

  it('quien la atiende sale de la sesión aunque el cuerpo mande otro id', async () => {
    const repo = await repoConTres();
    const res = await atender(repo, 2, 'admin', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idEmpleado: ID_OTRO, atendidaPor: ID_OTRO, sub: ID_OTRO }),
    });
    expect(res.status).toBe(200);
    expect(repo.filas[1]?.atendidaPor).toBe(ID_ADMIN);
  });

  it('si falla el guardado responde 500 con un mensaje en español', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await atender(repoAlertasQueFalla, 1);
    expect(res.status).toBe(500);
    expect(ErrorAlertaSchema.parse(await res.json()).error).toMatch(/no se pudo guardar/i);
  });
});

describe('alertas de caja en el OpenAPI (US-18 P1-B)', () => {
  it('las dos rutas aparecen con seguridad Bearer y todas sus respuestas', async () => {
    const doc = (await (await crearApp().request('/openapi.json')).json()) as {
      paths: Record<
        string,
        Record<string, { security?: unknown; responses: Record<string, unknown> }>
      >;
    };
    const lista = doc.paths['/caja/alertas']?.get;
    const atenderDoc = doc.paths['/caja/alertas/{idAlerta}/atender']?.post;
    expect(lista?.security).toEqual([{ Bearer: [] }]);
    expect(Object.keys(lista?.responses ?? {}).sort()).toEqual(['200', '401', '403', '500']);
    expect(atenderDoc?.security).toEqual([{ Bearer: [] }]);
    expect(Object.keys(atenderDoc?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '500',
    ]);
  });
});
