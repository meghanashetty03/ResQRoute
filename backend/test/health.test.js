import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { openDatabase } from '../database/index.js';
import { createApp } from '../app.js';
import { config } from '../config.js';

async function fixture(t) {
  const database = openDatabase(':memory:');
  const server = createApp(database, { logger: { error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (database.isOpen) database.close();
  });
  return { database, url: `http://127.0.0.1:${server.address().port}` };
}

test('health checks the database and permits the local frontend', async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.database.status, 'connected');
  assert.equal(data.database.engine, 'SQLite');
});

test('database failure returns a meaningful 503', async (t) => {
  const { database, url } = await fixture(t);
  database.close();
  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Database is unavailable/);
});

test('unknown APIs return JSON 404 and unapproved browser origins return 403', async (t) => {
  const { url } = await fixture(t);
  const missing = await fetch(`${url}/api/not-implemented`, { method: 'POST' });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'Endpoint not found.');
  const forbidden = await fetch(`${url}/api/health`, { headers: { Origin: 'https://example.com' } });
  assert.equal(forbidden.status, 403);
});

test('schema initializes repeatedly without seeding operational data', () => {
  const database = openDatabase(':memory:');
  try {
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    for (const table of ['ambulances', 'emergencies', 'hazards', 'route_evaluations']) {
      assert.equal(database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total, 0);
    }
  } finally { database.close(); }
});

test('SQLite persists across restarts and initialization is idempotent', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'resqroute-stage1-'));
  const filename = path.join(directory, 'test.sqlite');
  try {
    const first = openDatabase(filename);
    first.prepare('INSERT INTO ambulances VALUES (?, ?, ?, ?, ?)')
      .run('TEST-ONLY', 12.87, 74.85, 'Available', new Date().toISOString());
    first.close();
    const second = openDatabase(filename);
    try { assert.equal(second.prepare('SELECT id FROM ambulances').get().id, 'TEST-ONLY'); }
    finally { second.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('application configuration is loopback-only', () => {
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5000);
});
