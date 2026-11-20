export function createHealthController(database) {
  return (_request, response, next) => {
    try {
      database.prepare('SELECT 1 AS ready').get();
      response.set('Cache-Control', 'no-store').json({
        status: 'ok',
        service: 'ResQRoute API',
        stage: 6,
        database: { status: 'connected', engine: 'SQLite' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      error.status = 503;
      next(error);
    }
  };
}
