const { config, validateConfig } = require('./config');
const { connectDb, ensureAdminIndexes, mongoose } = require('./db');
const { createApp } = require('./app');
const { startScheduler, stopScheduler } = require('./lib/scheduler');
const { AdminUser } = require('./models/admin');

async function main() {
  const problems = validateConfig();
  if (problems.length) {
    console.error(`[admin] Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }

  await connectDb();
  await ensureAdminIndexes();
  if (!(await AdminUser.exists({ role: 'owner', active: true }))) {
    console.warn('[admin] No owner account yet. Create one: npm run create-admin -- --email you@example.com --name "You"');
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[admin] Luvstor admin on :${config.port} (${config.isProd ? 'production' : 'development'})`);
  });
  startScheduler();

  const shutdown = (signal) => {
    console.log(`[admin] ${signal} — shutting down`);
    stopScheduler();
    server.close(() => {
      mongoose.connection.close(false).finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[admin] Failed to start:', err);
  process.exit(1);
});
