import { demoSegments } from '../data/segments.js';

export function migrate(database) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    const columns = new Set(database.prepare('PRAGMA table_info(hazards)').all().map((column) => column.name));
    const additions = {
      is_complete_closure: 'INTEGER NOT NULL DEFAULT 0 CHECK (is_complete_closure IN (0, 1))',
      segment_confirmed: 'INTEGER NOT NULL DEFAULT 0 CHECK (segment_confirmed IN (0, 1))',
      incident_id: 'TEXT',
      scenario_mode: "TEXT NOT NULL DEFAULT 'live' CHECK (scenario_mode IN ('live', 'demo'))",
      updated_at: "TEXT NOT NULL DEFAULT ''",
      scenario_id: 'TEXT',
    };
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name)) database.exec(`ALTER TABLE hazards ADD COLUMN ${name} ${definition}`);
    }
    database.exec(`
      UPDATE hazards SET updated_at = reported_at WHERE updated_at = '';
      CREATE TABLE IF NOT EXISTS road_segments (id TEXT PRIMARY KEY, label TEXT NOT NULL, mode TEXT NOT NULL, geometry_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS application_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO application_state VALUES ('hazard_revision', 0);
      CREATE TRIGGER IF NOT EXISTS hazards_insert_revision AFTER INSERT ON hazards BEGIN UPDATE application_state SET value = value + 1 WHERE key = 'hazard_revision'; END;
      CREATE TRIGGER IF NOT EXISTS hazards_update_revision AFTER UPDATE ON hazards BEGIN UPDATE application_state SET value = value + 1 WHERE key = 'hazard_revision'; END;
      CREATE TRIGGER IF NOT EXISTS hazards_delete_revision AFTER DELETE ON hazards BEGIN UPDATE application_state SET value = value + 1 WHERE key = 'hazard_revision'; END;
      CREATE TABLE IF NOT EXISTS route_calculations (id TEXT PRIMARY KEY, candidates_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS route_runtime (
        calculation_id TEXT PRIMARY KEY REFERENCES route_calculations(id),
        evaluation_json TEXT NOT NULL, version INTEGER NOT NULL,
        notifications_json TEXT NOT NULL DEFAULT '[]', active_until INTEGER NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS evaluation_runs (
        id TEXT PRIMARY KEY, calculation_id TEXT NOT NULL REFERENCES route_calculations(id),
        trigger_action TEXT NOT NULL, evaluated_at TEXT NOT NULL,
        scenario_mode TEXT NOT NULL, scenario_id TEXT,
        recommended_route_id TEXT, previous_route_id TEXT,
        hazard_revision INTEGER NOT NULL, is_reroute INTEGER NOT NULL,
        routes_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evaluation_runs_time ON evaluation_runs(evaluated_at);
      CREATE TABLE IF NOT EXISTS hospitals (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, latitude REAL NOT NULL CHECK(latitude BETWEEN -90 AND 90),
        longitude REAL NOT NULL CHECK(longitude BETWEEN -180 AND 180), address TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', capabilities_json TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hospital_availability_events (
        id TEXT PRIMARY KEY, hospital_id TEXT NOT NULL REFERENCES hospitals(id), status TEXT NOT NULL CHECK(status IN ('accepting','limited','diverting')),
        source_kind TEXT NOT NULL CHECK(source_kind IN ('staff','integration')), updated_by TEXT NOT NULL, updater_role TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, stale_after_seconds INTEGER NOT NULL CHECK(stale_after_seconds > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_hospital_availability_history ON hospital_availability_events(hospital_id,updated_at DESC);
      CREATE TABLE IF NOT EXISTS journeys (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK(status IN ('planned','en_route_to_patient','arrived_at_patient','patient_picked_up','en_route_to_hospital','arrived_at_hospital','handover_completed')),
        start_lat REAL NOT NULL CHECK(start_lat BETWEEN -90 AND 90), start_lng REAL NOT NULL CHECK(start_lng BETWEEN -180 AND 180),
        patient_lat REAL NOT NULL CHECK(patient_lat BETWEEN -90 AND 90), patient_lng REAL NOT NULL CHECK(patient_lng BETWEEN -180 AND 180),
        hospital_id TEXT REFERENCES hospitals(id), hospital_lat REAL NOT NULL CHECK(hospital_lat BETWEEN -90 AND 90), hospital_lng REAL NOT NULL CHECK(hospital_lng BETWEEN -180 AND 180),
        hospital_name TEXT NOT NULL DEFAULT '', hospital_address TEXT NOT NULL DEFAULT '', hospital_confirmed_at TEXT,
        ambulance_to_patient_calculation_id TEXT NOT NULL REFERENCES route_calculations(id),
        patient_to_hospital_calculation_id TEXT NOT NULL REFERENCES route_calculations(id),
        recommendations_json TEXT NOT NULL DEFAULT '[]', recommendations_generated_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        planned_at TEXT NOT NULL, en_route_to_patient_at TEXT, arrived_at_patient_at TEXT,
        patient_picked_up_at TEXT, en_route_to_hospital_at TEXT, arrived_at_hospital_at TEXT, handover_completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_journeys_status_updated ON journeys(status,updated_at DESC);
    `);
    const journeyColumns=new Set(database.prepare('PRAGMA table_info(journeys)').all().map((column)=>column.name));
    for(const [name,definition] of Object.entries({hospital_name:"TEXT NOT NULL DEFAULT ''",hospital_address:"TEXT NOT NULL DEFAULT ''",hospital_confirmed_at:'TEXT'})){
      if(!journeyColumns.has(name))database.exec(`ALTER TABLE journeys ADD COLUMN ${name} ${definition}`);
    }
    const insert = database.prepare('INSERT OR IGNORE INTO road_segments VALUES (?, ?, ?, ?)');
    for (const segment of demoSegments) insert.run(segment.id, segment.label, segment.mode, JSON.stringify(segment.geometry));
    database.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (1, ?)').run(new Date().toISOString());
    database.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (2, ?)').run(new Date().toISOString());
    database.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (3, ?)').run(new Date().toISOString());
    database.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (4, ?)').run(new Date().toISOString());
    database.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (5, ?)').run(new Date().toISOString());
    database.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (6, ?)').run(new Date().toISOString());
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
