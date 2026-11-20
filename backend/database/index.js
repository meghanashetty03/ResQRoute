import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate.js';

export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  try {
    database.exec('PRAGMA busy_timeout = 5000;');
    database.exec('PRAGMA journal_mode = WAL;');
    database.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    migrate(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
