const mongoose = require('mongoose');
const { config } = require('./config');

// Never build indexes or create collections implicitly — the app backend owns
// its schema. Admin-only collections are indexed explicitly in ensureAdminIndexes.
mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);
mongoose.set('strictQuery', false);

async function connectDb() {
  await mongoose.connect(config.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15_000,
    appName: 'luvstor-admin',
  });
  return mongoose.connection;
}

async function ensureAdminIndexes() {
  const { AdminUser, AuditLog, TicketNote, Campaign } = require('./models/admin');
  for (const model of [AdminUser, AuditLog, TicketNote, Campaign]) {
    await model.createCollection().catch((err) => {
      if (err?.codeName !== 'NamespaceExists') throw err;
    });
    await model.createIndexes();
  }
}

async function pingDb() {
  const started = Date.now();
  await mongoose.connection.db.admin().ping();
  return Date.now() - started;
}

module.exports = { connectDb, ensureAdminIndexes, pingDb, mongoose };
