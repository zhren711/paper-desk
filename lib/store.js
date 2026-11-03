// 论文存储：每篇论文由若干 JSON 文档组成（meta 和每个章节 s:<id>）。
// 设置了 DATABASE_URL 就用 PostgreSQL，否则用本地 SQLite 文件。
// 每个文档带 rev 版本号，写入时需带上 baseRev，防止两个窗口互相覆盖。
import fs from 'node:fs';
import path from 'node:path';

const assetsTable = blob => [
  `CREATE TABLE IF NOT EXISTS assets (
     id TEXT PRIMARY KEY,
     paper_id TEXT NOT NULL,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     data ${blob} NOT NULL,
     created_at BIGINT NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS assets_paper ON assets (paper_id)',
];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS papers (
     id TEXT PRIMARY KEY,
     created_at BIGINT NOT NULL,
     updated_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS docs (
     paper_id TEXT NOT NULL,
     key TEXT NOT NULL,
     body TEXT NOT NULL,
     rev INTEGER NOT NULL,
     updated_at BIGINT NOT NULL,
     PRIMARY KEY (paper_id, key))`,
];

function shape(rows) {
  let meta = null, bib = null;
  const sections = [];
  for (const r of rows) {
    const doc = { body: JSON.parse(r.body), rev: Number(r.rev) };
    if (r.key === 'meta') meta = doc;
    else if (r.key === 'bib') bib = doc;
    else if (r.key.startsWith('s:')) sections.push({ id: r.key.slice(2), ...doc });
  }
  return { meta, bib, sections };
}

export async function openStore() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return sqliteStore(process.env.SQLITE_PATH || './data/paper-desk.db');
}

async function sqliteStore(file) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  for (const s of [...SCHEMA, ...assetsTable('BLOB')]) db.exec(s);
  const q = {
    insAsset: db.prepare('INSERT INTO assets (id, paper_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    getAsset: db.prepare('SELECT name, mime, size, data FROM assets WHERE paper_id = ? AND id = ?'),
    delAsset: db.prepare('DELETE FROM assets WHERE paper_id = ? AND id = ?'),
    delAssets: db.prepare('DELETE FROM assets WHERE paper_id = ?'),
    sumAssets: db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM assets WHERE paper_id = ?'),
    insPaper: db.prepare('INSERT INTO papers (id, created_at, updated_at) VALUES (?, ?, ?)'),
    hasPaper: db.prepare('SELECT 1 AS ok FROM papers WHERE id = ?'),
    touch: db.prepare('UPDATE papers SET updated_at = ? WHERE id = ?'),
    docs: db.prepare('SELECT key, body, rev FROM docs WHERE paper_id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM docs WHERE paper_id = ?'),
    cur: db.prepare('SELECT rev FROM docs WHERE paper_id = ? AND key = ?'),
    upsert: db.prepare(`INSERT INTO docs (paper_id, key, body, rev, updated_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT (paper_id, key) DO UPDATE SET body = excluded.body, rev = docs.rev + 1, updated_at = excluded.updated_at
      WHERE docs.rev = ? RETURNING rev`),
    delDoc: db.prepare('DELETE FROM docs WHERE paper_id = ? AND key = ?'),
    delDocs: db.prepare('DELETE FROM docs WHERE paper_id = ?'),
    delPaper: db.prepare('DELETE FROM papers WHERE id = ?'),
  };
  return {
    kind: `SQLite (${file})`,
    async createPaper(id) { const t = Date.now(); q.insPaper.run(id, t, t); },
    async exists(id) { return !!q.hasPaper.get(id); },
    async getPaper(id) { return q.hasPaper.get(id) ? shape(q.docs.all(id)) : null; },
    async countDocs(id) { return Number(q.count.get(id).n); },
    async hasDoc(id, key) { return !!q.cur.get(id, key); },
    async putDoc(id, key, body, baseRev) {
      const row = q.upsert.get(id, key, JSON.stringify(body), Date.now(), baseRev);
      if (!row) { const c = q.cur.get(id, key); return { conflict: true, rev: c ? Number(c.rev) : 0 }; }
      q.touch.run(Date.now(), id);
      return { rev: Number(row.rev) };
    },
    async deleteDoc(id, key) { q.delDoc.run(id, key); q.touch.run(Date.now(), id); },
    async deletePaper(id) { q.delDocs.run(id); q.delAssets.run(id); q.delPaper.run(id); },
    async putAsset(id, a) { q.insAsset.run(a.id, id, a.name, a.mime, a.size, a.data, Date.now()); },
    async getAsset(id, aid) { const r = q.getAsset.get(id, aid); return r ? { ...r, data: Buffer.from(r.data) } : null; },
    async deleteAsset(id, aid) { q.delAsset.run(id, aid); },
    async assetsSize(id) { return Number(q.sumAssets.get(id).n); },
  };
}

async function pgStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  for (const s of [...SCHEMA, ...assetsTable('BYTEA')]) await pool.query(s);
  const one = async (sql, args) => (await pool.query(sql, args)).rows[0];
  return {
    kind: 'PostgreSQL',
    async createPaper(id) { const t = Date.now(); await pool.query('INSERT INTO papers (id, created_at, updated_at) VALUES ($1, $2, $3)', [id, t, t]); },
    async exists(id) { return !!(await one('SELECT 1 AS ok FROM papers WHERE id = $1', [id])); },
    async getPaper(id) {
      if (!(await this.exists(id))) return null;
      return shape((await pool.query('SELECT key, body, rev FROM docs WHERE paper_id = $1', [id])).rows);
    },
    async countDocs(id) { return Number((await one('SELECT COUNT(*) AS n FROM docs WHERE paper_id = $1', [id])).n); },
    async hasDoc(id, key) { return !!(await one('SELECT 1 AS ok FROM docs WHERE paper_id = $1 AND key = $2', [id, key])); },
    async putDoc(id, key, body, baseRev) {
      const row = await one(`INSERT INTO docs (paper_id, key, body, rev, updated_at) VALUES ($1, $2, $3, 1, $4)
        ON CONFLICT (paper_id, key) DO UPDATE SET body = EXCLUDED.body, rev = docs.rev + 1, updated_at = EXCLUDED.updated_at
        WHERE docs.rev = $5 RETURNING rev`, [id, key, JSON.stringify(body), Date.now(), baseRev]);
      if (!row) { const c = await one('SELECT rev FROM docs WHERE paper_id = $1 AND key = $2', [id, key]); return { conflict: true, rev: c ? Number(c.rev) : 0 }; }
      await pool.query('UPDATE papers SET updated_at = $1 WHERE id = $2', [Date.now(), id]);
      return { rev: Number(row.rev) };
    },
    async deleteDoc(id, key) {
      await pool.query('DELETE FROM docs WHERE paper_id = $1 AND key = $2', [id, key]);
      await pool.query('UPDATE papers SET updated_at = $1 WHERE id = $2', [Date.now(), id]);
    },
    async deletePaper(id) {
      await pool.query('DELETE FROM docs WHERE paper_id = $1', [id]);
      await pool.query('DELETE FROM assets WHERE paper_id = $1', [id]);
      await pool.query('DELETE FROM papers WHERE id = $1', [id]);
    },
    async putAsset(id, a) {
      await pool.query('INSERT INTO assets (id, paper_id, name, mime, size, data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [a.id, id, a.name, a.mime, a.size, a.data, Date.now()]);
    },
    async getAsset(id, aid) { return (await one('SELECT name, mime, size, data FROM assets WHERE paper_id = $1 AND id = $2', [id, aid])) || null; },
    async deleteAsset(id, aid) { await pool.query('DELETE FROM assets WHERE paper_id = $1 AND id = $2', [id, aid]); },
    async assetsSize(id) { return Number((await one('SELECT COALESCE(SUM(size), 0) AS n FROM assets WHERE paper_id = $1', [id])).n); },
  };
}
