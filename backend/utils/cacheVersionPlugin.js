/**
 * Mongoose plugin: after any write that changes rows, bump the per-user cache
 * version (utils/cache.bump) for every user the rows belong to.
 *
 *   schema.plugin(cacheVersionPlugin, { scope: 'msg', fields: ['senderId', 'receiverId'] })
 *
 * Users come from the written doc, or from the query filter (userId / senderId /
 * receiverId / roomId "a_b"). Filters that only name `_id` cost one extra
 * lookup of those rows (ids only) before the write.
 *
 * `relevant(update)` (optional) skips the bump for updates that can't change
 * cached values — e.g. ConversationState counters vs. the archived flag.
 */
const cache = require('./cache');

const QUERY_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];
const LOOKUP_LIMIT = 2000;

function idsFromValue(v) {
  if (v == null) return [];
  if (typeof v === 'object' && !v._bsontype && !(typeof v.toHexString === 'function')) {
    if (Array.isArray(v.$in)) return v.$in.map(String);
    if (v.$eq != null) return [String(v.$eq)];
    return [];
  }
  return [String(v)];
}

function roomUsers(room) {
  return idsFromValue(room).flatMap((r) => String(r).split('_'));
}

function usersFromDoc(doc, fields, roomField) {
  if (!doc) return [];
  const out = [];
  for (const f of fields) if (doc[f]) out.push(String(doc[f]));
  if (roomField && doc[roomField]) out.push(...String(doc[roomField]).split('_'));
  return out;
}

function usersFromFilter(filter, fields, roomField) {
  if (!filter) return [];
  const out = [];
  for (const f of fields) out.push(...idsFromValue(filter[f]));
  if (roomField) out.push(...roomUsers(filter[roomField]));
  for (const op of ['$or', '$and']) {
    if (Array.isArray(filter[op])) {
      for (const sub of filter[op]) out.push(...usersFromFilter(sub, fields, roomField));
    }
  }
  return out;
}

function changedCount(op, res) {
  // Returns the pre-update doc by default — null on upsert, so it can't tell us
  if (op === 'findOneAndUpdate') return 1;
  if (res == null) return 0;
  if (op.startsWith('findOneAnd')) return 1;
  if (op.startsWith('delete')) return res.deletedCount || 0;
  return (res.modifiedCount || 0) + (res.upsertedCount || 0);
}

module.exports = function cacheVersionPlugin(schema, { scope, fields, roomField, relevant }) {
  const bumpSafe = async (users) => {
    const list = users.filter((u) => /^[a-f0-9]{24}$/i.test(u));
    if (!list.length) return;
    try {
      await cache.bump(scope, list);
    } catch {
      /* TTL backstop */
    }
  };

  schema.post('save', async function postSave(doc) {
    await bumpSafe(usersFromDoc(doc, fields, roomField));
  });

  schema.post('insertMany', async function postInsertMany(docs) {
    const list = Array.isArray(docs) ? docs : [docs];
    await bumpSafe(list.flatMap((d) => usersFromDoc(d, fields, roomField)));
  });

  schema.pre(QUERY_OPS, { document: false, query: true }, async function preWrite() {
    this._cacheUsers = null;
    try {
      if (relevant && !relevant(this.getUpdate?.() || null, this.op)) return;
      const filter = this.getFilter();
      let users = usersFromFilter(filter, fields, roomField);
      if (!users.length && filter && filter._id != null) {
        const select = [...fields, roomField].filter(Boolean).join(' ');
        const rows = await this.model
          .find(filter)
          .select(select)
          .limit(this.op.endsWith('Many') ? LOOKUP_LIMIT : 1)
          .lean();
        users = rows.flatMap((r) => usersFromDoc(r, fields, roomField));
      }
      this._cacheUsers = users;
    } catch {
      this._cacheUsers = null;
    }
  });

  schema.post(QUERY_OPS, { document: false, query: true }, async function postWrite(res) {
    const users = this._cacheUsers;
    if (!users || !changedCount(this.op, res)) return;
    const fromDoc = this.op.startsWith('findOneAnd') ? usersFromDoc(res, fields, roomField) : [];
    await bumpSafe([...users, ...fromDoc]);
  });
};

module.exports._internals = { idsFromValue, usersFromFilter, changedCount };
