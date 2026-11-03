import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { openStore } from './lib/store.js';
import { buildPrompt } from './lib/prompts.js';
import { createAI } from './lib/ai.js';
import { examplePaper } from './lib/example.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const PORT = Number(process.env.PORT) || 3000;
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();
const AI_PER_HOUR = Number(process.env.AI_REQUESTS_PER_HOUR) || 200;
const NEW_PAPERS_PER_HOUR = Number(process.env.NEW_PAPERS_PER_HOUR) || 30;
const MAX_DOC_BYTES = 400_000;
const MAX_DOCS_PER_PAPER = 300;

const ID_RE = /^[A-Za-z0-9]{16}$/;
const SID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const newId = () => Array.from(crypto.randomBytes(16), b => ID_ALPHABET[b % ID_ALPHABET.length]).join('');

const store = await openStore();
const ai = createAI();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use('/api/ai/outline', express.json({ limit: '45mb' }));
app.use(express.json({ limit: '1mb' }));

/* ---------- 静态页面 ---------- */
const PUBLIC = path.join(__dirname, 'public');
const INDEX = path.join(PUBLIC, 'index.html');
// 给 app.js / style.css 加上版本号，重新部署后浏览器会立刻用上新代码
const ASSET_VERSION = crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(PUBLIC, 'app.js')))
  .update(fs.readFileSync(path.join(PUBLIC, 'style.css')))
  .digest('hex').slice(0, 10);
const INDEX_HTML = fs.readFileSync(INDEX, 'utf8')
  .replace('href="/style.css"', `href="/style.css?v=${ASSET_VERSION}"`)
  .replace('src="/app.js"', `src="/app.js?v=${ASSET_VERSION}"`);
app.use(express.static(PUBLIC, { index: false, maxAge: '10m' }));
app.get('/vendor/jszip.min.js', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=604800');
  res.sendFile(require.resolve('jszip/dist/jszip.min.js'));
});
app.get(['/', '/p/:id'], (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(INDEX_HTML);
});
app.use('/vendor/katex', express.static(path.dirname(require.resolve('katex')), { maxAge: '30d', immutable: true }));
app.use('/vendor/pdfjs', express.static(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'build'), { maxAge: '30d', immutable: true }));
app.get('/healthz', (req, res) => res.json({ ok: true }));

/* ---------- 访问码与限流 ---------- */
function codeOk(req) {
  if (!ACCESS_CODE) return true;
  const a = Buffer.from(String(req.get('x-access-code') || ''));
  const b = Buffer.from(ACCESS_CODE);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = req.ip || 'unknown';
    const now = Date.now();
    let v = hits.get(k);
    if (!v || now - v.start > windowMs) { v = { start: now, n: 0 }; hits.set(k, v); }
    if (++v.n > max) return res.status(429).json({ code: 'rate_limited', message: '请求太频繁，请稍后再试' });
    next();
  };
}
const aiLimit = limiter(AI_PER_HOUR, 3600_000);
const newPaperLimit = limiter(NEW_PAPERS_PER_HOUR, 3600_000);
const outlineLimit = limiter(Number(process.env.OUTLINES_PER_HOUR) || 20, 3600_000);

app.get('/api/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ needCode: !!ACCESS_CODE, codeOk: codeOk(req), ai: ai.ready, demo: ai.mock });
});
app.use('/api', (req, res, next) => {
  if (codeOk(req)) return next();
  res.status(401).json({ code: 'unauthorized', message: '访问码不正确' });
});

/* ---------- 论文 ---------- */
const notFound = res => res.status(404).json({ code: 'not_found', message: '没有找到这篇论文' });
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

app.post('/api/papers', newPaperLimit, async (req, res) => {
  const id = newId();
  await store.createPaper(id);
  if (req.body && req.body.example) {
    const ex = examplePaper();
    await store.putDoc(id, 'meta', ex.meta, 0);
    for (const [sid, body] of Object.entries(ex.sections)) await store.putDoc(id, 's:' + sid, body, 0);
  }
  res.status(201).json({ id });
});

app.get('/api/papers/:id', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id)) return notFound(res);
  const p = await store.getPaper(id);
  if (!p) return notFound(res);
  res.setHeader('Cache-Control', 'no-store');
  res.json(p);
});

app.delete('/api/papers/:id', async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id) || !(await store.exists(id))) return notFound(res);
  await store.deletePaper(id);
  res.json({ ok: true });
});

async function putDoc(req, res, key) {
  const { id } = req.params;
  if (!ID_RE.test(id) || !(await store.exists(id))) return notFound(res);
  const { body, baseRev } = req.body || {};
  if (!isObj(body)) return res.status(400).json({ code: 'bad_request', message: 'body 必须是对象' });
  if (JSON.stringify(body).length > MAX_DOC_BYTES) return res.status(413).json({ code: 'too_big', message: '这一节内容太长，请拆分成多个章节' });
  if (!(await store.hasDoc(id, key)) && (await store.countDocs(id)) >= MAX_DOCS_PER_PAPER) {
    return res.status(413).json({ code: 'too_many', message: '章节数量已达上限' });
  }
  const r = await store.putDoc(id, key, body, Number.isInteger(baseRev) ? baseRev : 0);
  if (r.conflict) return res.status(409).json({ code: 'conflict', rev: r.rev, message: '这份内容已在别处被修改' });
  res.json({ rev: r.rev });
}
app.put('/api/papers/:id/meta', (req, res) => putDoc(req, res, 'meta'));
app.put('/api/papers/:id/bib', (req, res) => putDoc(req, res, 'bib'));

/* ---------- 图片与 PDF 图（插图用） ---------- */
const ASSET_TYPES = { 'application/pdf': [0x25, 0x50, 0x44, 0x46], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff] };
const MAX_ASSET = 12 * 1024 * 1024;
const MAX_ASSETS_PER_PAPER = 150 * 1024 * 1024;
const AID_RE = /^[A-Za-z0-9]{12}$/;
app.post('/api/papers/:id/assets', express.raw({ type: () => true, limit: MAX_ASSET }), async (req, res) => {
  const { id } = req.params;
  if (!ID_RE.test(id) || !(await store.exists(id))) return notFound(res);
  const mime = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const magic = ASSET_TYPES[mime];
  const buf = req.body;
  if (!magic) return res.status(415).json({ code: 'bad_type', message: '只支持 PDF、PNG、JPG' });
  if (!Buffer.isBuffer(buf) || !buf.length || !magic.every((b, i) => buf[i] === b)) return res.status(400).json({ code: 'bad_file', message: '文件内容和类型不符' });
  if ((await store.assetsSize(id)) + buf.length > MAX_ASSETS_PER_PAPER) return res.status(413).json({ code: 'too_many', message: '这篇论文的图片总量已达上限' });
  let name = 'figure';
  try { name = decodeURIComponent(String(req.get('x-file-name') || 'figure')); } catch {}
  name = name.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 120) || 'figure';
  const aid = newId().slice(0, 12);
  await store.putAsset(id, { id: aid, name, mime, size: buf.length, data: buf });
  res.status(201).json({ id: aid, name, mime, size: buf.length });
});
app.get('/api/papers/:id/assets/:aid', async (req, res) => {
  const { id, aid } = req.params;
  if (!ID_RE.test(id) || !AID_RE.test(aid)) return notFound(res);
  const a = await store.getAsset(id, aid);
  if (!a) return notFound(res);
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(Buffer.from(a.data));
});
app.delete('/api/papers/:id/assets/:aid', async (req, res) => {
  const { id, aid } = req.params;
  if (!ID_RE.test(id) || !AID_RE.test(aid)) return notFound(res);
  await store.deleteAsset(id, aid);
  res.json({ ok: true });
});
app.put('/api/papers/:id/sections/:sid', (req, res) => {
  if (!SID_RE.test(req.params.sid)) return res.status(400).json({ code: 'bad_request', message: '章节编号不合法' });
  return putDoc(req, res, 's:' + req.params.sid);
});
app.delete('/api/papers/:id/sections/:sid', async (req, res) => {
  const { id, sid } = req.params;
  if (!ID_RE.test(id) || !SID_RE.test(sid) || !(await store.exists(id))) return notFound(res);
  await store.deleteDoc(id, 's:' + sid);
  res.json({ ok: true });
});

/* ---------- 润色 / 翻译（流式，NDJSON） ---------- */
app.post('/api/ai/outline', outlineLimit);
app.post('/api/ai/:task', aiLimit, async (req, res) => {
  let job;
  try { job = buildPrompt(req.params.task, req.body); }
  catch (e) { return res.status(e.status || 400).json({ code: e.status === 413 ? 'too_big' : 'bad_request', message: e.message }); }
  if (!ai.ready) return res.status(503).json({ code: 'no_key', message: '服务器没有配置 ANTHROPIC_API_KEY' });

  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ac.abort(); });
  const send = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
  try {
    const r = await ai.stream(job, { signal: ac.signal, onText: d => send({ t: 'd', d }) });
    send({ t: 'end', truncated: r.truncated });
  } catch (e) {
    if (!ac.signal.aborted) {
      console.error(`[ai:${job.task}]`, e && (e.status || ''), e && e.message);
      send({ t: 'err', code: ai.errorCode(e) });
    }
  }
  res.end();
});

app.use('/api', (req, res) => res.status(404).json({ code: 'not_found', message: '接口不存在' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return res.end();
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ code: status === 413 ? 'too_big' : 'server_error', message: '服务器出错了' });
});

app.listen(PORT, () => {
  console.log(`论文译写台已启动：http://localhost:${PORT}`);
  console.log(`存储：${store.kind}`);
  console.log(`Claude：${ai.mock ? '演示模式（AI_MOCK=1）' : ai.ready ? `${ai.models.main} / ${ai.models.fast}` : '未配置 ANTHROPIC_API_KEY'}`);
  console.log(`访问码：${ACCESS_CODE ? '已启用' : '未设置（任何知道网址的人都能使用）'}`);
});
