import { createApp } from './app.js';
import { config } from './config.js';
import { openDatabase } from './database/index.js';

let database;
try {
  database = openDatabase(config.databasePath);
} catch (error) {
  console.error('SQLite initialization failed:', error.message);
  process.exit(1);
}

const server = createApp(database).listen(config.port, config.host, (error) => {
  if (error) return; // Express 5 also invokes this callback for listen errors.
  console.log(`ResQRoute API: http://localhost:${config.port} (bound to ${config.host})`);
  console.log('SQLite migrated safely. Routing, hazard rerouting and hospital availability APIs are ready.');
});

server.on('error', (error) => {
  console.error(`Cannot start local API on ${config.host}:${config.port}: ${error.message}`);
  database.close();
  process.exitCode = 1;
});

function shutdown() {
  server.close(() => {
    database.close();
    process.exitCode = 0;
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
