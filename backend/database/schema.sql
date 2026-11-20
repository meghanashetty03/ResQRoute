PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ambulances (
  id TEXT PRIMARY KEY,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  status TEXT NOT NULL CHECK (status IN ('Available', 'Busy')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS emergencies (
  id TEXT PRIMARY KEY,
  emergency_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')),
  pickup_lat REAL NOT NULL CHECK (pickup_lat BETWEEN -90 AND 90),
  pickup_lng REAL NOT NULL CHECK (pickup_lng BETWEEN -180 AND 180),
  hospital_lat REAL CHECK (hospital_lat BETWEEN -90 AND 90),
  hospital_lng REAL CHECK (hospital_lng BETWEEN -180 AND 180),
  assigned_ambulance_id TEXT NOT NULL REFERENCES ambulances(id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((hospital_lat IS NULL) = (hospital_lng IS NULL))
);

CREATE TABLE IF NOT EXISTS hazards (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  severity TEXT NOT NULL CHECK (severity IN ('Low', 'Medium', 'High')),
  description TEXT NOT NULL DEFAULT '',
  verification_status TEXT NOT NULL DEFAULT 'Reported'
    CHECK (verification_status IN ('Reported', 'Verified', 'Rejected')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  affected_segment_id TEXT,
  reported_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS route_evaluations (
  id TEXT PRIMARY KEY,
  emergency_id TEXT NOT NULL REFERENCES emergencies(id),
  route_id TEXT NOT NULL,
  distance_km REAL NOT NULL CHECK (distance_km >= 0),
  duration_minutes REAL NOT NULL CHECK (duration_minutes >= 0),
  risk_score REAL NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  final_cost REAL NOT NULL CHECK (final_cost >= 0),
  is_eligible INTEGER NOT NULL CHECK (is_eligible IN (0, 1)),
  is_recommended INTEGER NOT NULL CHECK (is_recommended IN (0, 1)),
  evaluated_at TEXT NOT NULL,
  CHECK (is_recommended = 0 OR is_eligible = 1)
);

CREATE INDEX IF NOT EXISTS idx_route_evaluations_emergency
  ON route_evaluations(emergency_id);
