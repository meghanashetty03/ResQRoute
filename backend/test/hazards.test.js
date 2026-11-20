import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { openDatabase } from '../database/index.js';
import { demoSegments } from '../data/segments.js';
import { createHazard, getHazard, hazardRevision, updateHazard } from '../services/hazardService.js';

export const sampleHazard = { type: 'road_damage', latitude: 12.87, longitude: 74.85, severity: 'Medium', description: 'Test-only road damage' };
async function fixture(t) {
  const database = openDatabase(':memory:');
  const server = createApp(database, { logger: { error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); database.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/hazards`;
  const request = (method, suffix = '', body) => fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { database, request };
}

test('hazard CRUD persists real rows, defaults Reported, increments revision, and preserves ID/timestamp', async (t) => {
  const { database, request } = await fixture(t);
  const created = await request('POST', '', sampleHazard);
  assert.equal(created.status, 201);
  const { hazard, revision } = await created.json();
  assert.match(hazard.id, /^HAZ-/);
  assert.equal(hazard.verification_status, 'Reported');
  assert.equal(hazard.is_active, true);
  assert.equal(hazard.segment_confirmed, false);
  assert.equal(revision, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM hazards').get().n, 1);
  assert.deepEqual((await (await request('GET', `/${hazard.id}`)).json()).hazard, hazard);
  const patch = await request('PATCH', `/${hazard.id}`, { severity: 'High', verification_status: 'Verified' });
  const modified = (await patch.json()).hazard;
  assert.equal(modified.severity, 'High');
  assert.equal(modified.verification_status, 'Verified');
  assert.equal(modified.reported_at, hazard.reported_at);
  assert.equal(hazardRevision(database), 2);
  await request('PATCH', `/${hazard.id}`, { verification_status: 'Rejected', is_active: false });
  const list = await (await request('GET')).json();
  assert.equal(list.hazards[0].verification_status, 'Rejected');
  assert.equal(list.hazards[0].is_active, false);
  assert.ok(list.segments.length >= 4);
  const removed = await request('DELETE', `/${hazard.id}`);
  assert.equal((await removed.json()).deletedId, hazard.id);
  assert.equal((await request('GET', `/${hazard.id}`)).status, 404);
  assert.equal((await request('PATCH', '/missing', {severity:'High'})).status, 404);
  assert.equal((await request('DELETE', '/missing')).status, 404);
});

test('hazard API rejects malformed input, fake server-owned fields and invalid confirmations', async (t) => {
  const { request } = await fixture(t);
  for (const body of [null, {}, [], {...sampleHazard, id:'fake'}, {...sampleHazard, latitude:91}, {...sampleHazard, longitude:'74'}, {...sampleHazard, type:'unknown'}, {...sampleHazard, severity:'Critical'}, {...sampleHazard, description:' '}, {...sampleHazard, is_active:1}, {...sampleHazard, verification_status:'Verified'}, {...sampleHazard, expires_at:'not a date'}, {...sampleHazard, expires_at:'2000-01-01T00:00:00Z'}, {...sampleHazard, segment_confirmed:true}, {...sampleHazard, affected_segment_id:'fake'}, {...sampleHazard, incident_id:''}, {...sampleHazard, scenario_mode:'cloud'}]) {
    const result = await request('POST', '', body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(typeof (await result.json()).error, 'string');
  }
});

test('assigned segment must belong to same mode and be geographically near the hazard', () => {
  const db = openDatabase(':memory:');
  try {
    const segment = demoSegments[0];
    const [longitude, latitude] = segment.geometry.coordinates[0];
    const input = {...sampleHazard, latitude, longitude, scenario_mode:'demo', affected_segment_id:segment.id, segment_confirmed:true, is_complete_closure:true};
    assert.throws(() => createHazard(db, {...input, scenario_mode:'live'}), /same scenario/);
    assert.throws(() => createHazard(db, {...input, latitude:13}), /30 metres/);
    const report = createHazard(db, input);
    assert.equal(report.is_complete_closure, true);
    assert.equal(report.verification_status, 'Reported');
    assert.throws(() => updateHazard(db, report.id, {affected_segment_id:null}), /confirmation/);
  } finally { db.close(); }
});

test('legacy SQLite migration and a restart retain hazard/emergency data and schema is idempotent', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'resqroute-migration-'));
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  const filename = path.join(directory, 'legacy.sqlite');
  try {
    const legacy = new DatabaseSync(filename);
    legacy.exec(readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));
    legacy.prepare('INSERT INTO ambulances VALUES (?, ?, ?, ?, ?)').run('KEEP', 12, 74, 'Available', '2026-01-01');
    legacy.prepare('INSERT INTO emergencies (id,emergency_type,priority,pickup_lat,pickup_lng,assigned_ambulance_id,status,created_at) VALUES (?,?,?,?,?,?,?,?)').run('KEEP-EMERGENCY','Medical emergency','High',12.87,74.85,'KEEP','Draft','2026-01-01T00:00:00Z');
    legacy.prepare('INSERT INTO hazards (id,type,latitude,longitude,severity,description,reported_at) VALUES (?,?,?,?,?,?,?)').run('KEEP-HAZ', 'road_damage', 12.87, 74.85, 'Low', 'Existing report', '2026-01-01T00:00:00Z');
    legacy.close();
    const migrated = openDatabase(filename);
    assert.equal(getHazard(migrated, 'KEEP-HAZ').description, 'Existing report');
    assert.equal(getHazard(migrated, 'KEEP-HAZ').segment_confirmed, false);
    const added = createHazard(migrated, sampleHazard);
    migrated.close();
    const reopened = openDatabase(filename);
    try {
      assert.equal(getHazard(reopened, added.id).description, sampleHazard.description);
      assert.equal(reopened.prepare('SELECT id FROM ambulances').get().id, 'KEEP');
      assert.equal(reopened.prepare('SELECT id FROM emergencies').get().id, 'KEEP-EMERGENCY');
      assert.equal(reopened.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 6);
    } finally { reopened.close(); }
  } finally { rmSync(directory, {recursive:true,force:true}); }
});
