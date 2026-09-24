import { HealthResponseSchema } from '@serviceagent/shared';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { app } from '../src/index';

describe('GET /health', () => {
  it('responde 200 con { ok: true, version }', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body).toEqual({ ok: true, version: pkg.version });
  });
});

describe('Documentación', () => {
  it('publica /health en el OpenAPI', async () => {
    const res = await app.request('/openapi.json');

    expect(res.status).toBe(200);
    const doc = (await res.json()) as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty('/health');
  });

  it('sirve Swagger UI en /docs', async () => {
    const res = await app.request('/docs');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });
});
