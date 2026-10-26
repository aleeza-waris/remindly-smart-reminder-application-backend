import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import app from '../src/app.js';
import { createCorsMiddleware, parseClientOrigins } from '../src/config/cors.js';

describe('CORS configuration', () => {
  it('defaults to the local Next.js development origin outside production', () => {
    assert.deepEqual(parseClientOrigins(undefined, 'development'), ['http://localhost:3000']);
  });

  it('accepts comma-separated HTTPS production origins', () => {
    assert.deepEqual(
      parseClientOrigins('https://remindly.example,https://www.remindly.example', 'production'),
      ['https://remindly.example', 'https://www.remindly.example']
    );
  });

  it('requires explicit secure origins in production', () => {
    assert.throws(() => parseClientOrigins(undefined, 'production'), /CLIENT_ORIGINS/);
    assert.throws(
      () => parseClientOrigins('http://remindly.example', 'production'),
      /invalid origin/
    );
  });

  it('rejects wildcard and URL values that are not origins', () => {
    assert.throws(() => parseClientOrigins('*', 'development'), /invalid origin/);
    assert.throws(
      () => parseClientOrigins('https://remindly.example/path', 'development'),
      /invalid origin/
    );
  });

  it('handles authorized browser preflight without enabling credentials', async () => {
    const response = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-timezone');

    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000');
    assert.match(response.headers['access-control-allow-methods'], /POST/);
    assert.match(response.headers['access-control-allow-headers'], /Authorization/i);
    assert.match(response.headers['access-control-allow-headers'], /Content-Type/i);
    assert.match(response.headers['access-control-allow-headers'], /X-Timezone/i);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
  });

  it('allows a configured production frontend origin on preflight requests', async () => {
    const productionApp = express();
    productionApp.use(
      createCorsMiddleware(
        'https://remindly.example,https://www.remindly.example',
        'production'
      )
    );

    const response = await request(productionApp)
      .options('/api/auth/login')
      .set('Origin', 'https://www.remindly.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-timezone');

    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], 'https://www.remindly.example');
    assert.match(response.headers['access-control-allow-headers'], /X-Timezone/i);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
  });

  it('does not grant CORS access to an unconfigured origin', async () => {
    const response = await request(app)
      .options('/api/auth/login')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');

    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });
});
