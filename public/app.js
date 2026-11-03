(() => {
'use strict';

/* ================= utilities ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const str = v => typeof v === 'string' ? v : (v == null ? '' : String(v));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  let val;
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'value') val = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  if (val !== undefined) n.value = val;
  return n;
}
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch {} }

function autosize(t) {
  if (!t || !t.isConnected) return;
  const sc = $('#edMain') || $('#editor'); const top = sc ? sc.scrollTop : 0; const wy = window.scrollY;
  t.style.height = 'auto';
  t.style.height = (t.scrollHeight + 2) + 'px';
  if (sc) sc.scrollTop = top;
  if (window.scrollY !== wy) window.scrollTo(0, wy);
}
function autosizeAll(root) { requestAnimationFrame(() => $$('textarea.ta, textarea.pt-ta, textarea.note-ta, textarea.side-pt, textarea.side-note', root).forEach(autosize)); }

function wordCount(en) {
  const t = str(en).replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^}]*\})?/g, ' ').replace(/\$[^$]*\$/g, ' x ');
  return (t.match(/[A-Za-z0-9][A-Za-z0-9'’\-]*/g) || []).length;
}
const fmtNum = n => n.toLocaleString('en-US');
async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

/* ================= server API ================= */
let accessCode = lsGet('pd:code', '');
const ID_RE = /^[A-Za-z0-9]{16}$/;
const routeMatch = location.pathname.match(/^\/p\/([A-Za-z0-9]{16})\/?$/);
const paperId = routeMatch ? routeMatch[1] : null;

async function api(method, url, body, opts = {}) {
  const init = { method, headers: { 'x-access-code': accessCode || '' } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
    if (opts.keepalive && init.body.length < 60000) init.keepalive = true;
  }
  let res;
  try { res = await fetch(url, init); } catch { throw { code: 'network' }; }
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) { gateThenReload(); throw { code: 'unauthorized' }; }
  if (!res.ok) throw { status: res.status, ...(data || {}), code: (data && data.code) || 'http_' + res.status };
  return data;
}

/* ================= views ================= */
function showView(name) {
  $('#gate').hidden = name !== 'gate';
  $('#home').hidden = name !== 'home';
  $('#app').hidden = name !== 'desk';
}
let gateResolve = null;
function showGate(msg) {
  showView('gate');
  $('#gateMsg').textContent = msg || '';
  $('#gateCode').value = '';
  setTimeout(() => $('#gateCode').focus(), 0);
  return new Promise(r => (gateResolve = r));
}
$('#gateForm').addEventListener('submit', async e => {
  e.preventDefault();
  accessCode = $('#gateCode').value.trim();
  const cfg = await fetchConfig().catch(() => null);
  if (!cfg) { $('#gateMsg').textContent = '连不上服务器，请稍后再试。'; return; }
  if (!cfg.codeOk) { $('#gateMsg').textContent = '访问码不正确。'; return; }
  lsSet('pd:code', accessCode);
  if (gateResolve) { const r = gateResolve; gateResolve = null; r(cfg); }
  else location.reload();
});
function gateThenReload() { if (!$('#gate').hidden) return; showGate('访问码已失效，请重新输入。').then(() => location.reload()); }
async function fetchConfig() {
  const res = await fetch('/api/config', { headers: { 'x-access-code': accessCode || '' } });
  if (!res.ok) throw new Error('config');
  return res.json();
}

/* ---------- home ---------- */
function recentPapers() { const l = lsGet('pd:papers', []); return Array.isArray(l) ? l.filter(x => x && ID_RE.test(x.id)) : []; }
function rememberPaper(id, title, titleEn) {
  const l = recentPapers().filter(x => x.id !== id);
  l.unshift({ id, title: str(title), titleEn: str(titleEn), at: Date.now() });
  lsSet('pd:papers', l.slice(0, 100));
}
function forgetPaper(id) { lsSet('pd:papers', recentPapers().filter(x => x.id !== id)); }
function fmtDate(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function renderHome(msg) {
  showView('home');
  document.title = '我的论文 · 论文译写台';
  $('#homeMsg').textContent = msg || '';
  const list = $('#paperList');
  const items = recentPapers();
  if (!items.length) {
    list.replaceChildren(h('li', {}, h('div', { class: 'pl-empty' }, '还没有论文。点“新建论文”开始，或先打开示例论文看看效果。')));
    return;
  }
  list.replaceChildren(...items.map(it => {
    const x = h('button', { class: 'btn ghost icon-btn', type: 'button', title: '从列表移除（不会删除论文）', 'aria-label': '从列表移除' }, '×');
    x.addEventListener('click', () => { forgetPaper(it.id); renderHome(); });
    return h('li', {},
      h('a', { href: '/p/' + it.id },
        h('span', { class: 'pl-title' }, it.title.trim() || '未命名论文'),
        h('span', { class: 'pl-date' }, fmtDate(it.at)),
        it.titleEn.trim() ? h('span', { class: 'pl-en' }, it.titleEn.trim()) : null),
      x);
  }));
}
async function createPaper(example) {
  const btns = [$('#btnNew'), $('#btnExample')]; btns.forEach(b => (b.disabled = true));
  try {
    const { id } = await api('POST', '/api/papers', example ? { example: true } : {});
    location.assign('/p/' + id);
  } catch (e) {
    btns.forEach(b => (b.disabled = false));
    if (e.code !== 'unauthorized') $('#homeMsg').textContent = e.code === 'rate_limited' ? '新建得太频繁了，请稍后再试。' : '没能新建论文，请检查网络后再试。';
  }
}
$('#btnNew').addEventListener('click', () => createPaper(false));
$('#btnExample').addEventListener('click', () => createPaper(true));
$('#openForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#openInput').value.trim();
  const m = v.match(/([A-Za-z0-9]{16})\/?$/);
  if (!m) { $('#homeMsg').textContent = '这不像论文链接。链接的结尾应是 /p/ 加 16 位字母数字。'; return; }
  location.assign('/p/' + m[1]);
});

/* ================= data model ================= */
const STRENGTH = {
  light:  { label: '轻', help: '只修正病句、衔接词和指代不清，尽量保留原句与语序。' },
  medium: { label: '中', help: '理顺句间逻辑，补足必要衔接，删去重复与口语化表达。' },
  heavy:  { label: '重', help: '可重组句序，使段落形成“主题句—论据—小结”的结构。' },
};
const TEMPLATE = [
  ['引言', 'Introduction', ['研究背景与问题的重要性', '现有方法的不足', '本文的方法与主要贡献']],
  ['相关工作', 'Related Work', ['', '']],
  ['方法', 'Method', ['', '']],
  ['实验', 'Experiments', ['数据集与评价指标', '对比实验结果', '消融实验']],
  ['结论', 'Conclusion', ['总结贡献', '局限与未来工作']],
];

function blankPaper() { return { title: '', titleEn: '', field: '', brief: '', strength: 'medium', spelling: 'US', glossary: [], order: [], zhComments: true }; }
function normPaper(m) {
  const o = Object.assign(blankPaper(), m || {});
  o.title = str(o.title); o.titleEn = str(o.titleEn); o.field = str(o.field); o.brief = str(o.brief);
  o.glossary = Array.isArray(o.glossary) ? o.glossary.map(g => ({ zh: str(g && g.zh), en: str(g && g.en) })) : [];
  o.order = Array.isArray(o.order) ? o.order.map(String) : [];
  if (!STRENGTH[o.strength]) o.strength = 'medium';
  if (o.spelling !== 'UK') o.spelling = 'US';
  o.zhComments = o.zhComments !== false;
  return o;
}
const isText = p => !p.type || p.type === 'text';
function normGrid(g) {
  g = g || {};
  let rows = Array.isArray(g.rows) ? g.rows.slice(0, 40).map(r => (Array.isArray(r) ? r.slice(0, 16).map(str) : [])) : [];
  if (!rows.length) rows = [['', '', ''], ['', '', ''], ['', '', '']];
  const cols = Math.max(1, ...rows.map(r => r.length));
  rows = rows.map(r => { const x = r.slice(); while (x.length < cols) x.push(''); return x; });
  const align = Array.from({ length: cols }, (_, i) => (['l', 'c', 'r'].includes(g.align && g.align[i]) ? g.align[i] : (i ? 'c' : 'l')));
  return { rows, header: g.header !== false, align };
}
function normPara(p) {
  p = p || {};
  const id = str(p.id) || uid();
  const cap = { captionZh: str(p.captionZh), captionEn: str(p.captionEn), captionFrom: str(p.captionFrom), label: str(p.label) };
  if (p.type === 'figure') {
    const a = p.asset && typeof p.asset === 'object' ? { id: str(p.asset.id), name: str(p.asset.name), mime: str(p.asset.mime) } : null;
    const w = Number(p.width);
    return { id, type: 'figure', asset: a && a.id ? a : null, width: w > 0 && w <= 1 ? w : 0.8, ...cap };
  }
  if (p.type === 'table') return { id, type: 'table', mode: p.mode === 'latex' ? 'latex' : 'grid', grid: normGrid(p.grid), latex: str(p.latex), ...cap };
  return { id, type: 'text', zh: str(p.zh), polished: str(p.polished), notes: Array.isArray(p.notes) ? p.notes.map(String).slice(0, 6) : [], en: str(p.en), point: str(p.point), polishedFrom: str(p.polishedFrom), enFrom: str(p.enFrom) };
}
function paraBody(p) {
  const cap = { captionZh: p.captionZh, captionEn: p.captionEn, captionFrom: p.captionFrom, label: p.label };
  if (p.type === 'figure') return { id: p.id, type: 'figure', asset: p.asset, width: p.width, ...cap };
  if (p.type === 'table') return { id: p.id, type: 'table', mode: p.mode, grid: p.grid, latex: p.latex, ...cap };
  return { id: p.id, zh: p.zh, polished: p.polished, notes: p.notes, en: p.en, point: p.point, polishedFrom: p.polishedFrom, enFrom: p.enFrom };
}
function normSec(id, s) {
  s = s || {};
  return {
    id, titleZh: str(s.titleZh), titleEn: str(s.titleEn), note: str(s.note),
    points: Array.isArray(s.points) ? s.points.map(x => ({ id: str(x && x.id) || uid(), text: str(x && x.text) })) : [],
    paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs.map(normPara) : [],
  };
}
function newSection(titleZh = '新章节', titleEn = '', points = [''], note = '') {
  return { id: 's' + uid(), titleZh, titleEn, note, points: points.map(t => ({ id: uid(), text: t })), paragraphs: [] };
}

let paper = blankPaper();
let sections = {};
let activeId = null;
let readOnly = false;
let showDiff = lsGet('pd:diff', true);
let enPreview = lsGet('pd:enPreview', true);
let bib = { entries: [] };
let collapsed = lsGet('pd:collapsed', true);
let exportScope = 'sec';
const rtMap = new Map();
const R = id => { if (!rtMap.has(id)) rtMap.set(id, {}); return rtMap.get(id); };
const activeSec = () => sections[activeId] || null;
const secIndex = id => paper.order.indexOf(id);
const activeKey = () => 'pd:active:' + paperId;

function paraState(p) {
  const r = R(p.id);
  if (!isText(p)) return r.err ? ['error', '未完成'] : ['done', p.type === 'figure' ? '图' : '表'];
  if (r.busy === 'polish') return ['polishing', '润色中'];
  if (r.busy === 'translate') return ['translating', '翻译中'];
  if (r.queued) return ['queued', '排队中'];
  if (r.err) return ['error', '未完成'];
  if (!p.polished) return ['draft', '草稿'];
  if (p.zh !== p.polishedFrom) return ['stale', '草稿已改'];
  if (!p.en) return ['stale', '待翻译'];
  if (p.polished !== p.enFrom) return ['stale', '待重译'];
  return ['done', '已完成'];
}
function secStats(sec) {
  const texts = sec.paragraphs.filter(isText);
  const n = texts.length;
  const done = texts.filter(p => paraState(p)[0] === 'done').length;
  const words = texts.reduce((a, p) => a + wordCount(p.en), 0);
  return { n, done, words };
}

/* ================= persistence (REST, optimistic revisions) ================= */
let loaded = false;
const lastJSON = new Map(), revs = new Map(), timers = new Map(), inflight = new Map(), again = new Set();
let saveErr = null, retryTimer = null;

function metaBody() {
  const { title, titleEn, field, brief, strength, spelling, glossary, order, zhComments } = paper;
  return { title, titleEn, field, brief, strength, spelling, glossary, order, zhComments };
}
function secBody(id) {
  const s = sections[id]; if (!s) return null;
  return { titleZh: s.titleZh, titleEn: s.titleEn, note: s.note, points: s.points, paragraphs: s.paragraphs.map(paraBody) };
}
function touch(key) {
  if (readOnly || !loaded) return;
  scheduleNumbering();
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => flush(key), 800));
  updateSaveState();
}
const touchMeta = () => touch('meta');
const touchSec = id => touch('s:' + id);
const touchBib = () => touch('bib');
const bibBody = () => ({ entries: bib.entries.map(e => ({ key: e.key, type: e.type, raw: e.raw })) });

async function flush(key, opts = {}) {
  clearTimeout(timers.get(key)); timers.delete(key);
  if (readOnly) return;
  if (inflight.has(key)) { again.add(key); return; }
  const job = (async () => {
    const sid = key === 'meta' || key === 'bib' ? null : key.slice(2);
    const body = key === 'meta' ? metaBody() : key === 'bib' ? bibBody() : secBody(sid);
    const json = body === null ? null : JSON.stringify(body);
    if (lastJSON.has(key) && lastJSON.get(key) === json) return;
    if (json === null) {
      await api('DELETE', `/api/papers/${paperId}/sections/${encodeURIComponent(sid)}`, undefined, opts);
      revs.delete(key);
    } else {
      const url = key === 'meta' ? `/api/papers/${paperId}/meta` : key === 'bib' ? `/api/papers/${paperId}/bib` : `/api/papers/${paperId}/sections/${encodeURIComponent(sid)}`;
      const r = await api('PUT', url, { body, baseRev: revs.get(key) || 0 }, opts);
      revs.set(key, r.rev);
      if (key === 'meta') rememberPaper(paperId, paper.title, paper.titleEn);
    }
    lastJSON.set(key, json);
  })();
  inflight.set(key, job);
  try { await job; if (!timers.size) saveErr = null; }
  catch (e) {
    saveErr = e;
    if (e.code === 'conflict') {
      setReadOnly(true, '这篇论文在另一个窗口或设备上被修改过。为避免互相覆盖，这里已暂停保存，请刷新页面载入最新内容。');
    } else if (e.code === 'not_found') {
      setReadOnly(true, '这篇论文已被删除。');
    } else if (e.code === 'network' || e.code === 'server_error' || e.code === 'rate_limited' || /^http_5/.test(e.code)) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => flush(key), 5000);
    }
  } finally {
    inflight.delete(key);
    if (again.delete(key)) flush(key);
    updateSaveState();
  }
}
function flushAll(opts) { for (const k of Array.from(timers.keys())) flush(k, opts); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll({ keepalive: true }); });
window.addEventListener('beforeunload', e => { if (timers.size || inflight.size) { flushAll({ keepalive: true }); e.preventDefault(); e.returnValue = ''; } });

function updateSaveState() {
  const el = $('#saveState');
  let s, t;
  if (!loaded) { s = 'loading'; t = '连接中…'; }
  else if (readOnly) { s = 'readonly'; t = '已暂停保存'; }
  else if (timers.size || inflight.size) { s = 'saving'; t = '保存中…'; }
  else if (saveErr) {
    s = 'error';
    t = ({ too_big: '本节太长，无法保存，请拆分', too_many: '章节太多，无法保存', network: '网络中断，稍后自动重试', rate_limited: '保存太频繁，稍后自动重试' })[saveErr.code] || '未能保存，稍后自动重试';
  }
  else { s = 'ok'; t = '已保存'; }
  el.dataset.s = s; el.textContent = t;
}
function setReadOnly(v, msg) {
  if (readOnly === v) return;
  readOnly = v;
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  if (v) notice('ro', msg || '已暂停保存。');
  renderAll();
}

/* ================= notices ================= */
const notices = new Map();
function notice(key, text) { if (text) notices.set(key, text); else notices.delete(key); renderBanner(); }
function renderBanner() {
  const b = $('#banner');
  b.replaceChildren(...Array.from(notices.values()).map(t => h('p', {}, t)));
  b.hidden = notices.size === 0;
}

/* ================= AI (server proxy to Claude) ================= */
const ai = { state: 'loading' };
let aiResolve; const aiReadyP = new Promise(r => (aiResolve = r));
const aiUsable = () => ai.state !== 'off';
async function aiReady() { await aiReadyP; return ai.state === 'ok'; }
function aiOff(msg) {
  ai.state = 'off';
  notice('ai', msg);
  refreshAllRows(); refreshComposerBtn();
}

async function streamAI(task, payload, { signal, onText } = {}) {
  let res;
  try {
    res = await fetch('/api/ai/' + task, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-access-code': accessCode || '' },
      body: JSON.stringify(payload),
    });
  } catch { throw { code: signal && signal.aborted ? 'cancelled' : 'network' }; }
  if (res.status === 401) { gateThenReload(); throw { code: 'unauthorized' }; }
  if (!res.ok) { let d = {}; try { d = await res.json(); } catch {} throw { code: d.code || 'upstream_error' }; }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', truncated = false, ended = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.t === 'd') { text += ev.d; if (onText) onText(text); }
        else if (ev.t === 'end') { truncated = !!ev.truncated; ended = true; }
        else if (ev.t === 'err') throw { code: ev.code || 'upstream_error', text };
      }
    }
  } catch (e) {
    if (signal && signal.aborted) throw { code: 'cancelled', text };
    if (e && e.code) throw e;
    throw { code: 'network', text };
  }
  if (!ended) throw { code: signal && signal.aborted ? 'cancelled' : 'network', text };
  return { text, truncated };
}

const MAX_RUN = 2; let running = 0; const waiters = [];
function slot(signal) {
  if (running < MAX_RUN) { running++; return Promise.resolve(true); }
  return new Promise(res => {
    const w = { res }; waiters.push(w);
    signal.addEventListener('abort', () => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); res(false); } }, { once: true });
  });
}
function release() { const w = waiters.shift(); if (w) w.res(true); else running = Math.max(0, running - 1); }

const OFF_CODES = { no_key: '网站还没有配置 Claude API key，润色与翻译暂不可用；编辑与导出仍可使用。', bad_key: '服务器上的 Claude API key 无效或没有权限，请网站管理员检查配置。' };
function errCopy(code) {
  return ({
    rate_limited: '请求太频繁，请稍后再试。',
    overloaded: 'Claude 当前繁忙，请稍后再试。',
    refused: 'Claude 没有处理这一段，请调整内容后再试。',
    bad_request: '请求格式不对，请刷新页面后再试。',
    empty_completion: '没有得到结果，请再试一次。',
    network: '网络中断，没有完成，请再试一次。',
  })[code] || '没有完成，请再试一次。';
}
function handleAIError(p, e) {
  const r = R(p.id); const code = (e && e.code) || 'upstream_error';
  if (code === 'cancelled' || code === 'unauthorized') { r.err = ''; return; }
  if (OFF_CODES[code]) { r.err = ''; aiOff(OFF_CODES[code]); return; }
  r.err = errCopy(code);
}

function glossary() { return paper.glossary.filter(g => g.zh.trim() && g.en.trim()); }
function ctxPayload(sec) {
  return {
    paper: { title: paper.title, titleEn: paper.titleEn, field: paper.field, brief: paper.brief, strength: paper.strength, spelling: paper.spelling, glossary: glossary() },
    section: { index: secIndex(sec.id), titleZh: sec.titleZh, titleEn: sec.titleEn, note: sec.note, points: sec.points.map(x => x.text) },
  };
}
function prevText(sec, p) {
  const i = sec.paragraphs.indexOf(p);
  for (let k = i - 1; k >= 0; k--) if (isText(sec.paragraphs[k])) return sec.paragraphs[k];
  return null;
}
function polishPayload(sec, p) {
  const prev = prevText(sec, p);
  return { ...ctxPayload(sec), linked: p.point ? sec.points.findIndex(x => x.id === p.point) : -1, prev: prev ? (prev.polished || prev.zh) : '', text: p.zh };
}
function translatePayload(sec, p) {
  const prev = prevText(sec, p);
  return { ...ctxPayload(sec), prev: prev ? prev.en : '', text: p.polished };
}

function parsePolish(raw) {
  const A = '【润色】', B = '【批注】', C = '【论点】';
  const a = raw.indexOf(A), b = raw.indexOf(B), c = raw.indexOf(C);
  if (a < 0 && b < 0 && raw.trim().length < 6) return { polished: '', notes: [], pointIdx: null };
  const start = a >= 0 ? a + A.length : 0;
  const ends = [b, c].filter(x => x >= start);
  const end = ends.length ? Math.min(...ends) : raw.length;
  const polished = raw.slice(start, end).replace(/【[^】]{0,3}$/, '').trim();
  let notes = [];
  if (b >= 0) {
    const nEnd = c > b ? c : raw.length;
    notes = raw.slice(b + B.length, nEnd).split('\n')
      .map(l => l.replace(/^\s*(?:[-•*·]|\d+[.、)])\s*/, '').trim())
      .filter(l => l && !/^【/.test(l)).slice(0, 5);
  }
  let pointIdx = null;
  if (c >= 0) { const m = raw.slice(c + C.length).match(/p\s*(\d+)/i); if (m) pointIdx = parseInt(m[1], 10) - 1; }
  return { polished, notes, pointIdx };
}
function cleanEn(t) {
  return str(t).replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').replace(/^<<<\s*|\s*>>>$/g, '').replace(/^English(?: translation)?\s*:\s*/i, '').trim();
}
function cleanTitle(t) {
  return str(t).split('\n')[0].replace(/^["“'`]+|["”'`]+$/g, '').replace(/^(§\s*)?\d+(\.\d+)*\s*/, '').replace(/[.。]$/, '').trim();
}

async function runPipeline(sec, p, from) {
  const r = R(p.id);
  if (r.busy || r.queued || readOnly) return;
  if (!p.zh.trim()) { r.err = '先写下中文草稿。'; refreshPara(sec, p); return; }
  if (!(await aiReady())) { refreshPara(sec, p); return; }
  r.err = '';
  if (from === 'polish') {
    r.pipeline = true;
    const ok = await doPolish(sec, p);
    r.pipeline = false;
    if (!ok) { refreshPara(sec, p); return; }
  }
  if (!p.polished.trim()) return;
  await doTranslate(sec, p);
}

async function doPolish(sec, p) {
  const r = R(p.id); const ctl = new AbortController();
  r.ctl = ctl; r.queued = true; r.liveZh = ''; refreshPara(sec, p);
  const got = await slot(ctl.signal);
  r.queued = false;
  if (!got || ctl.signal.aborted) { if (got) release(); r.ctl = null; refreshPara(sec, p); return false; }
  r.busy = 'polish'; refreshPara(sec, p);
  const source = p.zh;
  try {
    const { text } = await streamAI('polish', polishPayload(sec, p), {
      signal: ctl.signal,
      onText: t => { r.liveZh = parsePolish(t).polished; refreshLive(sec, p); },
    });
    const out = parsePolish(text);
    if (!out.polished) throw { code: 'empty_completion' };
    p.polished = out.polished; p.notes = out.notes; p.polishedFrom = source;
    if (out.pointIdx != null && sec.points[out.pointIdx] && !p.point) p.point = sec.points[out.pointIdx].id;
    if (sections[sec.id]) { touchSec(sec.id); updateCardStats(sec.id); updatePaperStats(); }
    return true;
  } catch (e) { handleAIError(p, e); return false; }
  finally { release(); r.busy = null; r.ctl = null; r.liveZh = ''; refreshPara(sec, p); }
}

async function doTranslate(sec, p) {
  const r = R(p.id); const ctl = new AbortController();
  if (!sec.titleEn.trim() && sec.titleZh.trim()) translateSectionTitle(sec);
  r.ctl = ctl; r.queued = true; r.liveEn = ''; refreshPara(sec, p);
  const got = await slot(ctl.signal);
  r.queued = false;
  if (!got || ctl.signal.aborted) { if (got) release(); r.ctl = null; refreshPara(sec, p); return false; }
  r.busy = 'translate'; refreshPara(sec, p);
  const source = p.polished;
  try {
    const { text, truncated } = await streamAI('translate', translatePayload(sec, p), {
      signal: ctl.signal,
      onText: t => { r.liveEn = cleanEn(t); refreshLive(sec, p); },
    });
    const en = cleanEn(text);
    if (!en) throw { code: 'empty_completion' };
    p.en = en; p.enFrom = source;
    r.err = truncated ? '译文被截断了，建议把这一段拆短后重译。' : '';
    if (sections[sec.id]) { touchSec(sec.id); updateCardStats(sec.id); updatePaperStats(); }
    return true;
  } catch (e) { handleAIError(p, e); return false; }
  finally { release(); r.busy = null; r.ctl = null; r.liveEn = ''; refreshPara(sec, p); }
}

async function translateTitleText(zh) {
  if (!(await aiReady())) return '';
  try {
    const { text } = await streamAI('title', { paper: { field: paper.field, glossary: glossary() }, text: zh });
    return cleanTitle(text);
  } catch (e) {
    if (OFF_CODES[e && e.code]) aiOff(OFF_CODES[e.code]);
    return '';
  }
}
async function translateSectionTitle(sec) {
  const r = R('t:' + sec.id); if (r.busy || !sec.titleZh.trim()) return;
  r.busy = true; setTitleBtnBusy(sec, true);
  const en = await translateTitleText(sec.titleZh.trim());
  r.busy = false; setTitleBtnBusy(sec, false);
  if (en && sections[sec.id]) {
    sec.titleEn = en; touchSec(sec.id);
    const inp = document.getElementById('secEn-' + sec.id);
    if (inp && document.activeElement !== inp) inp.value = en;
    updateCardStats(sec.id);
  }
}
function setTitleBtnBusy(sec, busy) {
  const b = document.getElementById('secEnBtn-' + sec.id);
  if (b) { b.disabled = busy; b.textContent = busy ? '翻译中…' : '译标题'; }
}

/* ================= diff (char-level, CJK friendly) ================= */
function diffChars(a, b) {
  const A = Array.from(a), B = Array.from(b), n = A.length, m = B.length;
  if (!n && !m) return [];
  if (!n) return [{ t: '+', s: b }];
  if (!m) return [{ t: '-', s: a }];
  if ((n + 1) * (m + 1) > 2000000) return null;
  const W = m + 1, L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * W + j] = A[i] === B[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const ops = []; let i = 0, j = 0;
  const push = (t, s) => { const l = ops[ops.length - 1]; if (l && l.t === t) l.s += s; else ops.push({ t, s }); };
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('=', A[i]); i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) { push('-', A[i]); i++; }
    else { push('+', B[j]); j++; }
  }
  while (i < n) push('-', A[i++]);
  while (j < m) push('+', B[j++]);
  const mid = [];
  ops.forEach((o, k) => {
    if (o.t === '=' && Array.from(o.s).length <= 2 && k > 0 && k < ops.length - 1 && ops[k - 1].t !== '=' && ops[k + 1].t !== '=') mid.push({ t: '-', s: o.s }, { t: '+', s: o.s });
    else mid.push(o);
  });
  const res = []; let del = '', ins = '';
  const fl = () => { if (del) res.push({ t: '-', s: del }); if (ins) res.push({ t: '+', s: ins }); del = ins = ''; };
  for (const o of mid) { if (o.t === '=') { fl(); res.push(o); } else if (o.t === '-') del += o.s; else ins += o.s; }
  fl();
  return res;
}

/* ================= rendering: header & panels ================= */
function renderHeader() {
  const t = $('#paperTitle');
  t.disabled = !loaded;
  t.readOnly = readOnly;
  if (document.activeElement !== t) t.value = paper.title;
  document.title = (paper.title.trim() || '未命名论文') + ' · 论文译写台';
}
$('#paperTitle').addEventListener('input', e => { paper.title = e.target.value; touchMeta(); document.title = (paper.title.trim() || '未命名论文') + ' · 论文译写台'; });
$('#btnLink').addEventListener('click', async () => {
  const b = $('#btnLink');
  const ok = await copyText(location.origin + '/p/' + paperId);
  b.textContent = ok ? '链接已复制' : '请复制地址栏里的网址';
  setTimeout(() => (b.textContent = '复制链接'), 2200);
});

function togglePanel(which) {
  const map = { settings: ['#btnSettings', '#panelSettings'], export: ['#btnExport', '#panelExport'], import: ['#btnImport', '#panelImport'] };
  for (const [k, [b, p]] of Object.entries(map)) {
    const open = k === which ? $(p).hidden : false;
    $(p).hidden = !open; $(b).setAttribute('aria-expanded', String(open));
  }
  if (!$('#panelExport').hidden) refreshExport();
  if (!$('#panelSettings').hidden) renderSettings();
  if (!$('#panelImport').hidden) openImport();
}
$('#btnSettings').addEventListener('click', () => togglePanel('settings'));
$('#btnExport').addEventListener('click', () => togglePanel('export'));

function segControl(options, current, onPick, label) {
  const g = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  options.forEach(([val, text]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(val === current), 'data-edit': '' }, text);
    b.addEventListener('click', () => { $$('button', g).forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); onPick(val); });
    g.append(b);
  });
  return g;
}

function renderSettings() {
  const body = $('#settingsBody');
  const titleEn = h('input', { class: 'inp en', id: 'fTitleEn', 'data-edit': '', placeholder: 'English title of the paper', value: paper.titleEn });
  titleEn.addEventListener('input', () => { paper.titleEn = titleEn.value; touchMeta(); });
  const tBtn = h('button', { class: 'btn tiny', type: 'button', 'data-edit': '' }, '从中文题目翻译');
  tBtn.addEventListener('click', async () => {
    if (!paper.title.trim()) { titleEn.placeholder = '先在顶部填写中文题目'; return; }
    tBtn.disabled = true; tBtn.textContent = '翻译中…';
    const en = await translateTitleText(paper.title.trim());
    tBtn.disabled = false; tBtn.textContent = '从中文题目翻译';
    if (en) { paper.titleEn = en; titleEn.value = en; touchMeta(); }
  });
  if (!aiUsable()) tBtn.hidden = true;

  const field = h('input', { class: 'inp', id: 'fField', 'data-edit': '', placeholder: '例如：交通工程、机器学习、材料科学', value: paper.field });
  field.addEventListener('input', () => { paper.field = field.value; touchMeta(); });

  const brief = h('textarea', { class: 'inp', id: 'fBrief', rows: '3', 'data-edit': '', placeholder: '研究什么问题、用什么方法、主要结果是什么', value: paper.brief });
  brief.addEventListener('input', () => { paper.brief = brief.value; touchMeta(); });

  const sHelp = h('p', { class: 'help' }, STRENGTH[paper.strength].help);
  const strength = segControl(Object.entries(STRENGTH).map(([k, v]) => [k, v.label]), paper.strength, v => { paper.strength = v; sHelp.textContent = STRENGTH[v].help; touchMeta(); }, '润色力度');
  const spelling = segControl([['US', 'American'], ['UK', 'British']], paper.spelling, v => { paper.spelling = v; touchMeta(); }, '英文拼写');

  const glList = h('div', { class: 'gl-list' });
  const drawGl = () => {
    glList.replaceChildren(...paper.glossary.map((g, i) => {
      const zh = h('input', { class: 'inp', id: 'glzh-' + i, 'data-edit': '', placeholder: '中文术语', value: g.zh, 'aria-label': '中文术语' });
      const en = h('input', { class: 'inp en', id: 'glen-' + i, 'data-edit': '', placeholder: 'English term', value: g.en, 'aria-label': '英文术语' });
      zh.addEventListener('input', () => { g.zh = zh.value; touchMeta(); });
      en.addEventListener('input', () => { g.en = en.value; touchMeta(); });
      const x = h('button', { class: 'btn ghost icon-btn', type: 'button', title: '删除术语', 'aria-label': '删除术语', 'data-edit': '' }, '×');
      x.addEventListener('click', () => { paper.glossary.splice(i, 1); touchMeta(); drawGl(); });
      return h('div', { class: 'gl-row' }, zh, h('span', { class: 'arrow' }, '→'), en, x);
    }));
    if (!paper.glossary.length) glList.append(h('p', { class: 'help' }, '还没有术语。加入专业术语后，翻译会始终使用你指定的英文说法。'));
    applyRO(glList);
  };
  drawGl();
  const addGl = h('button', { class: 'btn tiny', type: 'button', 'data-edit': '' }, '+ 添加术语');
  addGl.addEventListener('click', () => { paper.glossary.push({ zh: '', en: '' }); touchMeta(); drawGl(); const ins = $$('.gl-row input', glList); if (ins.length) ins[ins.length - 2].focus(); });

  const delBtn = confirmBtn('删除这篇论文', '确认删除？再点一次', deletePaper, 'btn tiny danger');

  body.replaceChildren(
    h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'fTitleEn' }, '英文题目'), h('div', { class: 'row' }, titleEn, tBtn)),
    h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'fField' }, '学科领域'), field, h('p', { class: 'help' }, '润色和翻译会按这个领域的写作习惯处理。')),
    h('div', { class: 'field' }, h('label', { class: 'lbl', for: 'fBrief' }, '研究内容简述'), brief, h('p', { class: 'help' }, '生成大纲和润色时都会参考。')),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, '润色力度'), strength, sHelp),
    h('div', { class: 'field' }, h('span', { class: 'lbl' }, '英文拼写'), spelling, h('p', { class: 'help' }, '例如 optimize / optimise，color / colour。')),
    h('div', { class: 'field glossary' }, h('span', { class: 'lbl' }, '术语表'), glList, h('div', {}, addGl)),
    readOnly ? null : h('div', { class: 'field danger-zone' }, delBtn, h('span', { class: 'help' }, '会从服务器上永久删除所有章节、段落和术语，拿到链接的人也将无法打开。')),
  );
  applyRO(body);
}

/* ================= rendering: outline ================= */
function renderOutline() {
  const outline = $('#outline'); outline.classList.toggle('is-collapsed', collapsed);
  const cb = $('#btnCollapse'); cb.textContent = collapsed ? '展开' : '收起'; cb.setAttribute('aria-pressed', String(collapsed));
  const track = $('#outlineTrack');
  if (!loaded) { track.replaceChildren(h('div', { class: 'outline-empty' }, '正在打开你的论文…')); return; }
  const cards = paper.order.map((id, i) => outlineCard(sections[id], i));
  if (!readOnly) {
    const add = h('div', { class: 'ocard add' });
    const b1 = h('button', { class: 'btn tiny', type: 'button' }, paper.order.length ? '+ 新增章节' : '+ 添加第一节');
    b1.addEventListener('click', addSection);
    add.append(b1);
    if (!paper.order.length) { const b2 = h('button', { class: 'btn tiny ghost', type: 'button' }, '套用常见结构'); b2.addEventListener('click', applyTemplate); add.append(b2); }
    cards.push(add);
  }
  track.replaceChildren(...cards);
  $('#btnImport').hidden = readOnly;
  applyRO(track);
  autosizeAll(track);
  updatePaperStats();
}
$('#btnCollapse').addEventListener('click', () => { collapsed = !collapsed; lsSet('pd:collapsed', collapsed); renderOutline(); });

function outlineCard(sec, i) {
  const title = h('input', { class: 'ocard-title', id: 'ct-' + sec.id, 'data-edit': '', value: sec.titleZh, placeholder: '章节标题', 'aria-label': `第 ${i + 1} 节标题` });
  title.addEventListener('input', () => {
    sec.titleZh = title.value; touchSec(sec.id);
    const e = document.getElementById('secZh-' + sec.id); if (e && document.activeElement !== e) e.value = title.value;
    syncSideTitle(sec);
  });
  const left = h('button', { type: 'button', title: '前移', 'aria-label': '前移本节', 'data-edit': '', disabled: i === 0 }, '←');
  const right = h('button', { type: 'button', title: '后移', 'aria-label': '后移本节', 'data-edit': '', disabled: i === paper.order.length - 1 }, '→');
  left.addEventListener('click', e => { e.stopPropagation(); moveSection(sec.id, -1); });
  right.addEventListener('click', e => { e.stopPropagation(); moveSection(sec.id, 1); });
  const num = h('button', { class: 'ocard-num', type: 'button', title: '打开本节' }, '§' + (i + 1));
  num.addEventListener('click', () => setActive(sec.id));

  const note = h('textarea', { class: 'note-ta', id: 'nt-' + sec.id, rows: '1', 'data-edit': '', placeholder: '本节作用（可选）', 'aria-label': `第 ${i + 1} 节的作用`, value: sec.note });
  note.addEventListener('input', () => { sec.note = note.value; touchSec(sec.id); autosize(note); syncValue('snt-' + sec.id, note.value); });
  const pts = h('ol', { class: 'points' }, sec.points.map((pt, k) => pointItem(sec, pt, k)));
  const addPt = h('button', { class: 'add-point', type: 'button', 'data-edit': '' }, '+ 论点');
  addPt.addEventListener('click', e => {
    e.stopPropagation();
    insertPoint(sec, sec.points.length, 'card');
  });
  const st = secStats(sec);
  const card = h('article', { class: 'ocard' + (sec.id === activeId ? ' is-active' : ''), 'data-id': sec.id },
    h('header', { class: 'ocard-head' }, num, title, h('div', { class: 'ocard-move' }, left, right)),
    h('div', { class: 'ocard-en' + (sec.titleEn.trim() ? '' : ' missing') }, sec.titleEn.trim() || '英文标题待译'),
    note, pts, addPt,
    h('footer', { class: 'ocard-foot' },
      h('span', { class: 'foot-txt' }, footText(st)),
      h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: `width:${st.n ? Math.round(st.done / st.n * 100) : 0}%` }))),
  );
  card.addEventListener('click', e => { if (e.target.closest('input,textarea,button,select')) return; setActive(sec.id); });
  card.addEventListener('focusin', () => { if (activeId !== sec.id) setActive(sec.id, { keepScroll: true }); });
  return card;
}
const footText = st => `${st.n} 段 · ${st.done} 已完成 · ${fmtNum(st.words)} words`;

function pointItem(sec, pt, k) {
  const covered = sec.paragraphs.some(p => p.point === pt.id);
  const ta = h('textarea', { class: 'pt-ta', id: 'pt-' + pt.id, rows: '1', 'data-edit': '', placeholder: '写下一个要论证的观点', 'aria-label': `观点 p${k + 1}`, value: pt.text });
  ta.addEventListener('input', () => { pt.text = ta.value; touchSec(sec.id); autosize(ta); syncValue('spt-' + pt.id, ta.value); if (activeId === sec.id) refreshPointOptions(sec); });
  ta.addEventListener('keydown', e => pointKeys(e, sec, k, ta, 'card'));
  const x = h('button', { class: 'pt-x', type: 'button', title: '删除观点', 'aria-label': `删除观点 p${k + 1}`, 'data-edit': '' }, '×');
  x.addEventListener('click', e => { e.stopPropagation(); removePoint(sec, k, false); });
  return h('li', { class: 'point' + (covered ? ' is-covered' : ''), 'data-pid': pt.id }, h('span', { class: 'pmark', 'aria-hidden': 'true', title: covered ? '已有段落论证' : '尚无段落' }), ta, x);
}
function pointKeys(e, sec, k, ta, where) {
  if (e.isComposing) return;
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); insertPoint(sec, k + 1, where); }
  else if (e.key === 'Backspace' && ta.value === '') { e.preventDefault(); removePoint(sec, k, true, where); }
}
function insertPoint(sec, at, where) {
  const pt = { id: uid(), text: '' };
  sec.points.splice(at, 0, pt); touchSec(sec.id);
  renderCard(sec.id, where === 'card' ? () => { const t = document.getElementById('pt-' + pt.id); if (t) t.focus(); } : null);
  if (activeId === sec.id) {
    renderSide(sec);
    refreshPointOptions(sec);
    if (where === 'side') requestAnimationFrame(() => { const t = document.getElementById('spt-' + pt.id); if (t) t.focus(); });
  }
}
function removePoint(sec, k, focusPrev, where = 'card') {
  const [pt] = sec.points.splice(k, 1); if (!pt) return;
  sec.paragraphs.forEach(p => { if (p.point === pt.id) p.point = ''; });
  touchSec(sec.id);
  const prev = sec.points[Math.max(0, k - 1)];
  const focusIt = id => { const t = document.getElementById(id); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } };
  renderCard(sec.id, focusPrev && prev && where === 'card' ? () => focusIt('pt-' + prev.id) : null);
  if (activeId === sec.id) {
    renderSide(sec);
    refreshPointOptions(sec); sec.paragraphs.forEach(p => refreshPara(sec, p));
    if (focusPrev && prev && where === 'side') requestAnimationFrame(() => focusIt('spt-' + prev.id));
  }
}
function syncValue(id, value) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el && el.value !== value) { el.value = value; autosize(el); }
}
function renderCard(id, after) {
  const old = $(`.ocard[data-id="${id}"]`); const sec = sections[id]; if (!old || !sec) return;
  const fresh = outlineCard(sec, secIndex(id));
  old.replaceWith(fresh); applyRO(fresh); autosizeAll(fresh);
  if (after) requestAnimationFrame(() => after(fresh));
}
function updateCardStats(id) {
  if (id === activeId && sections[id]) refreshSide(sections[id]);
  const card = $(`.ocard[data-id="${id}"]`); const sec = sections[id]; if (!card || !sec) return;
  const st = secStats(sec);
  $('.foot-txt', card).textContent = footText(st);
  $('.bar i', card).style.width = (st.n ? Math.round(st.done / st.n * 100) : 0) + '%';
  $$('.point', card).forEach(li => {
    const cov = sec.paragraphs.some(p => p.point === li.dataset.pid);
    li.classList.toggle('is-covered', cov);
    $('.pmark', li).title = cov ? '已有段落论证' : '尚无段落';
  });
  const en = $('.ocard-en', card);
  en.textContent = sec.titleEn.trim() || '英文标题待译'; en.classList.toggle('missing', !sec.titleEn.trim());
}
function updatePaperStats() {
  const all = paper.order.map(id => sections[id]).filter(Boolean);
  const paras = all.reduce((a, s) => a + s.paragraphs.length, 0);
  const words = all.reduce((a, s) => a + secStats(s).words, 0);
  $('#paperStats').textContent = loaded ? `${all.length} 节 · ${paras} 段 · ${fmtNum(words)} words` : '';
}

/* ================= rendering: editor ================= */
function setActive(id, opts = {}) {
  if (!sections[id]) return;
  activeId = id; lsSet(activeKey(), id);
  $$('.ocard').forEach(c => c.classList.toggle('is-active', c.dataset.id === id));
  renderEditor();
  const card = $(`.ocard[data-id="${id}"]`);
  if (card && !opts.keepScroll) card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  if (!$('#panelExport').hidden) refreshExport();
}

function renderEditor() {
  const ed = $('#editor');
  const inner = h('div', { class: 'ed-in wrap' });
  const main = h('div', { class: 'ed-main', id: 'edMain' }, inner);
  const sec = loaded ? activeSec() : null;
  ed.classList.toggle('has-side', !!sec);
  if (!loaded) { inner.append(h('p', { class: 'loading' }, '正在打开你的论文…')); ed.replaceChildren(main); return; }
  if (!sec) { inner.append(welcome()); ed.replaceChildren(main); applyRO(inner); return; }
  const paras = h('div', { class: 'paras', id: 'paras' }, sec.paragraphs.map(p => paraRow(sec, p)));
  tool.open = null;
  inner.append(secHead(sec), readOnly ? null : toolDock(), colsHead(), paras);
  if (!sec.paragraphs.length) inner.append(h('p', { class: 'sec-empty', id: 'secEmpty' }, '本节还没有段落。对照左边的观点，一段一段写下中文。'));
  if (!readOnly) inner.append(composer(sec));
  const side = h('aside', { class: 'ed-side', id: 'edSide', 'aria-label': '本节思路' });
  ed.replaceChildren(side, main);
  renderSide(sec);
  renumber(sec);
  main.scrollTop = 0;
  applyRO(inner);
  autosizeAll(inner);
}

/* ---------- left sidebar: the active section's outline ---------- */
function renderSide(sec) {
  const side = $('#edSide'); if (!side || sec.id !== activeId) return;
  const i = secIndex(sec.id);
  const note = h('textarea', { class: 'side-note', id: 'snt-' + sec.id, rows: '2', 'data-edit': '', placeholder: '这一节要完成什么？', 'aria-label': '本节作用', value: sec.note });
  note.addEventListener('input', () => { sec.note = note.value; touchSec(sec.id); autosize(note); syncValue('nt-' + sec.id, note.value); });
  const list = h('ol', { class: 'side-points' }, sec.points.map((pt, k) => sidePoint(sec, pt, k)));
  const add = h('button', { class: 'add-point', type: 'button', 'data-edit': '' }, '+ 添加观点');
  add.addEventListener('click', () => insertPoint(sec, sec.points.length, 'side'));
  const prevId = paper.order[i - 1], nextId = paper.order[i + 1];
  const nav = (id, label) => {
    const b = h('button', { class: 'btn ghost tiny', type: 'button', disabled: !id }, label);
    if (id) b.addEventListener('click', () => setActive(id));
    return b;
  };
  side.replaceChildren(
    h('div', { class: 'side-eyebrow' }, '本节思路'),
    h('div', { class: 'side-title' }, h('span', { class: 'side-num' }, '§' + (i + 1)), h('b', { class: 'side-zh' }, sec.titleZh.trim() || '未命名')),
    h('div', { class: 'side-en' + (sec.titleEn.trim() ? '' : ' missing') }, sec.titleEn.trim() || '英文标题待译'),
    h('label', { class: 'side-lbl', for: 'snt-' + sec.id }, '本节作用'),
    note,
    h('div', { class: 'side-lbl' }, h('span', {}, '要论证的观点'), h('span', { class: 'side-count' })),
    list,
    readOnly ? null : add,
    h('p', { class: 'side-hint' }, '点「写」会把新段落对应到这个观点；点段数可以跳到已写的段落。'),
    h('div', { class: 'side-nav' }, nav(prevId, '← 上一节'), nav(nextId, '下一节 →')),
  );
  refreshSide(sec);
  applyRO(side);
  autosizeAll(side);
}
function sidePoint(sec, pt, k) {
  const ta = h('textarea', { class: 'side-pt', id: 'spt-' + pt.id, rows: '1', 'data-edit': '', placeholder: '写下一个要论证的观点', 'aria-label': `观点 p${k + 1}`, value: pt.text });
  ta.addEventListener('input', () => { pt.text = ta.value; touchSec(sec.id); autosize(ta); syncValue('pt-' + pt.id, ta.value); refreshPointOptions(sec); });
  ta.addEventListener('keydown', e => pointKeys(e, sec, k, ta, 'side'));
  const count = h('button', { class: 'side-pt-count', type: 'button' });
  count.addEventListener('click', () => jumpToPoint(sec, pt.id));
  const write = h('button', { class: 'side-pt-write', type: 'button', title: '按这个观点写一段新的', 'data-edit': '' }, '写');
  write.addEventListener('click', () => writeForPoint(pt.id));
  const x = h('button', { class: 'pt-x', type: 'button', title: '删除观点', 'aria-label': `删除观点 p${k + 1}`, 'data-edit': '' }, '×');
  x.addEventListener('click', () => removePoint(sec, k, false, 'side'));
  const li = h('li', { class: 'side-point', 'data-pid': pt.id },
    h('span', { class: 'pmark', 'aria-hidden': 'true' }), h('span', { class: 'side-pt-n' }, 'p' + (k + 1)), ta, x,
    h('div', { class: 'side-pt-tools' }, count, readOnly ? null : write));
  li.addEventListener('mouseenter', () => highlightPoint(pt.id, true));
  li.addEventListener('mouseleave', () => highlightPoint(pt.id, false));
  return li;
}
function refreshSide(sec) {
  const side = $('#edSide'); if (!side || sec.id !== activeId) return;
  let covered = 0;
  $$('.side-point', side).forEach(li => {
    const n = sec.paragraphs.filter(p => p.point === li.dataset.pid).length;
    if (n) covered++;
    li.classList.toggle('is-covered', n > 0);
    const c = $('.side-pt-count', li);
    c.textContent = n ? `${n} 段` : '未写';
    c.disabled = !n;
    c.title = n ? '跳到对应的段落' : '还没有段落对应这个观点';
  });
  const total = sec.points.filter(p => p.text.trim()).length || sec.points.length;
  const cnt = $('.side-count', side); if (cnt) cnt.textContent = sec.points.length ? `${covered} / ${total} 已写` : '';
  const zh = $('.side-zh', side); if (zh) zh.textContent = sec.titleZh.trim() || '未命名';
  const en = $('.side-en', side); if (en) { en.textContent = sec.titleEn.trim() || '英文标题待译'; en.classList.toggle('missing', !sec.titleEn.trim()); }
}
function syncSideTitle(sec) { if (sec.id === activeId) refreshSide(sec); }
function highlightPoint(pid, on) {
  const sec = activeSec(); if (!sec) return;
  sec.paragraphs.forEach(p => { const row = document.getElementById('para-' + p.id); if (row) row.classList.toggle('is-linked', on && p.point === pid); });
}
function jumpToPoint(sec, pid) {
  const p = sec.paragraphs.find(x => x.point === pid); if (!p) return;
  const row = document.getElementById('para-' + p.id); if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  row.classList.remove('flash'); void row.offsetWidth; if (!reduceMotion) row.classList.add('flash');
}
function writeForPoint(pid) {
  const sel = $('#compPoint'), ta = $('#compText'); if (!sel || !ta) return;
  sel.value = pid;
  ta.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  ta.focus({ preventScroll: true });
}

function welcome() {
  const b0 = h('button', { class: 'btn primary', type: 'button' }, '从参考文章生成大纲');
  const b1 = h('button', { class: 'btn', type: 'button' }, '套用常见结构');
  const b2 = h('button', { class: 'btn', type: 'button' }, '添加空白章节');
  b0.addEventListener('click', () => { if ($('#panelImport').hidden) togglePanel('import'); });
  b1.addEventListener('click', applyTemplate); b2.addEventListener('click', addSection);
  return h('div', { class: 'welcome' },
    h('h1', {}, '从思路开始写'),
    h('p', {}, '先定好大纲：可以上传 1 到 3 篇你想借鉴的论文，按它们的论证逻辑生成；也可以套用常见结构，或自己逐节填写。然后在这里一段一段用中文写，每段完成后会先润色中文逻辑，再译成可以直接放进 LaTeX 的英文。'),
    readOnly ? null : h('div', { class: 'btns' }, b0, b1, b2),
    h('p', { class: 'small' }, '常见结构：引言 · 相关工作 · 方法 · 实验 · 结论'));
}

function secHead(sec) {
  const i = secIndex(sec.id);
  const zh = h('input', { class: 'sec-zh', id: 'secZh-' + sec.id, 'data-edit': '', value: sec.titleZh, placeholder: '章节标题', 'aria-label': '章节中文标题' });
  zh.addEventListener('input', () => {
    sec.titleZh = zh.value; touchSec(sec.id);
    const c = document.getElementById('ct-' + sec.id); if (c && document.activeElement !== c) c.value = zh.value;
    syncSideTitle(sec);
  });
  const en = h('input', { class: 'sec-en', id: 'secEn-' + sec.id, 'data-edit': '', value: sec.titleEn, placeholder: 'English section title', 'aria-label': '章节英文标题' });
  en.addEventListener('input', () => { sec.titleEn = en.value; touchSec(sec.id); updateCardStats(sec.id); });
  const tBtn = h('button', { class: 'btn tiny ghost', id: 'secEnBtn-' + sec.id, type: 'button', 'data-edit': '' }, '译标题');
  tBtn.addEventListener('click', () => translateSectionTitle(sec));
  if (!aiUsable()) tBtn.hidden = true;
  if (R('t:' + sec.id).busy) { tBtn.disabled = true; tBtn.textContent = '翻译中…'; }

  const diff = h('input', { type: 'checkbox', id: 'diffToggle' }); diff.checked = showDiff;
  diff.addEventListener('change', () => { showDiff = diff.checked; lsSet('pd:diff', showDiff); sec.paragraphs.forEach(p => { R(p.id).editPolish = false; refreshPara(sec, p); }); });
  const pv = h('input', { type: 'checkbox', id: 'pvToggle' }); pv.checked = enPreview;
  pv.addEventListener('change', () => {
    enPreview = pv.checked; lsSet('pd:enPreview', enPreview);
    sec.paragraphs.forEach(p => { R(p.id).editEn = false; refreshPara(sec, p); });
    const ch = $('.cols-head span:last-child i'); if (ch) ch.textContent = enPreview ? '排版预览，点击可改 LaTeX' : '可直接放进 LaTeX';
  });
  const copy = h('button', { class: 'btn tiny', type: 'button' }, '复制本节 LaTeX');
  copy.addEventListener('click', async () => {
    const ok = await copyText(sectionTex(sec, i, { zh: paper.zhComments }));
    if (ok && sec.paragraphs.some(p => p.type === 'figure')) toast('已复制。图片文件需要另外放进 Overleaf 的 figures 文件夹，或用「导出到 Overleaf」下载 .zip。');
    copy.textContent = ok ? '已复制' : '请在导出面板中复制';
    if (!ok) { exportScope = 'sec'; if ($('#panelExport').hidden) togglePanel('export'); else refreshExport(); selectPreview(); }
    setTimeout(() => (copy.textContent = '复制本节 LaTeX'), 1800);
  });
  const del = confirmBtn('删除本节', '确认删除本节？', () => deleteSection(sec.id));
  return h('div', { class: 'sec-head' },
    h('div', { class: 'sec-num', 'aria-hidden': 'true' }, '§' + (i + 1)),
    h('div', { class: 'sec-titles' }, zh, h('div', { class: 'sec-en-row' }, en, tBtn)),
    h('div', { class: 'sec-tools' }, h('label', { class: 'toggle', for: 'diffToggle' }, diff, '显示润色改动'), h('label', { class: 'toggle', for: 'pvToggle' }, pv, '英文排版预览'), copy, readOnly ? null : del));
}
function colsHead() {
  const s = (b, i) => h('span', {}, h('b', {}, b), h('i', {}, i));
  return h('div', { class: 'cols-head', 'aria-hidden': 'true' }, h('span'), s('草稿', '你写的中文'), s('润色', '理顺逻辑后的中文'), s('English', enPreview ? '排版预览，点击可改 LaTeX' : '可直接放进 LaTeX'));
}

function pointOptions(sec, value) {
  const opts = [h('option', { value: '' }, '未指定')];
  sec.points.forEach((pt, k) => opts.push(h('option', { value: pt.id }, `p${k + 1} · ${clip(pt.text.trim() || '（空）', 16)}`)));
  if (value && !sec.points.some(pt => pt.id === value)) value = '';
  return { opts, value };
}
function pointSelect(sec, value, onChange, id) {
  const { opts, value: v } = pointOptions(sec, value);
  const sel = h('select', { class: 'sel', id, 'data-edit': '', 'aria-label': '对应论点' }, opts);
  sel.value = v;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}
function refreshPointOptions(sec) {
  $$('select.p-point, #compPoint').forEach(sel => {
    const keep = sel.value; const { opts, value } = pointOptions(sec, keep);
    sel.replaceChildren(...opts); sel.value = value;
  });
}

function paraRow(sec, p) {
  if (!isText(p)) return floatRow(sec, p);
  const n = sec.paragraphs.slice(0, sec.paragraphs.indexOf(p) + 1).filter(isText).length;
  const draft = makeTA('ta zh', 'zh-' + p.id, p.zh, v => { p.zh = v; R(p.id).err = ''; touchSec(sec.id); refreshStatus(sec, p); }, '中文草稿');
  draft.dataset.insert = '草稿';
  draft.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (aiUsable()) runPipeline(sec, p, 'polish'); }
  });
  const sel = pointSelect(sec, p.point, v => { p.point = v; touchSec(sec.id); updateCardStats(sec.id); }, 'pp-' + p.id);
  sel.classList.add('p-point');
  const row = h('article', { class: 'para', id: 'para-' + p.id, 'data-id': p.id },
    h('div', { class: 'p-gutter' }, h('span', { class: 'p-num' }, '¶' + n), h('span', { class: 'pill' })),
    h('div', { class: 'cell c-draft' }, h('span', { class: 'cell-label' }, '草稿'), draft),
    h('div', { class: 'cell c-polish' }, h('span', { class: 'cell-label' }, '润色'), h('div', { class: 'polish-body' }), h('ul', { class: 'notes', 'aria-label': '逻辑批注' })),
    h('div', { class: 'cell c-en' }, h('span', { class: 'cell-label' }, 'English'), h('div', { class: 'en-body' }), h('div', { class: 'en-meta' })),
    h('div', { class: 'p-foot' }, h('label', { class: 'pt-label', for: 'pp-' + p.id }, h('span', {}, '对应论点'), sel), h('span', { class: 'p-msg', role: 'status' }), h('div', { class: 'p-actions' })),
  );
  refreshPara(sec, p, row);
  return row;
}
function makeTA(cls, id, value, oninput, label) {
  const t = h('textarea', { class: cls, id, 'data-edit': '', spellcheck: cls.includes('en') ? 'true' : 'false', 'aria-label': label });
  t.value = value;
  t.addEventListener('input', () => { autosize(t); oninput(t.value); });
  return t;
}

function refreshStatus(sec, p, row) {
  row = row || document.getElementById('para-' + p.id); if (!row) return;
  if (!isText(p)) {
    const pill = $('.pill', row);
    const stale = p.captionZh.trim() && (!p.captionEn.trim() || (p.captionFrom && p.captionFrom !== p.captionZh));
    const busy = R(p.id).busy === 'caption';
    pill.className = 'pill ' + (busy ? 'st-translating' : stale ? 'st-stale' : 'st-hidden');
    pill.textContent = busy ? '翻译中' : stale ? (p.captionEn.trim() ? '注已改' : '注待译') : '';
    renderActions(sec, p, row);
    $('.p-msg', row).textContent = R(p.id).err || '';
    return;
  }
  const [st, label] = paraState(p);
  const pill = $('.pill', row); pill.className = 'pill st-' + st; pill.textContent = label;
  renderActions(sec, p, row);
  $('.p-msg', row).textContent = R(p.id).err || '';
}
function refreshPara(sec, p, row) {
  row = row || document.getElementById('para-' + p.id); if (!row) return;
  if (!isText(p)) { refreshStatus(sec, p, row); refreshFloatPreview(sec, p, row); if (readOnly) applyRO(row); return; }
  refreshStatus(sec, p, row);
  renderPolishBody(sec, p, row);
  renderNotes(p, row);
  renderEnBody(sec, p, row);
  const sel = $('select.p-point', row);
  if (sel && document.activeElement !== sel) { const { value } = pointOptions(sec, p.point); sel.value = value; }
  if (readOnly) applyRO(row);
}
function refreshLive(sec, p) {
  const row = document.getElementById('para-' + p.id); if (!row) return;
  const r = R(p.id);
  const box = r.busy === 'polish' ? $('.polish-body', row) : $('.en-body', row);
  const live = box && $('.live', box); if (!live) { refreshPara(sec, p, row); return; }
  const text = r.busy === 'polish' ? r.liveZh : r.liveEn;
  if (text) { live.classList.remove('thinking'); live.textContent = text; }
}
function liveBox(text, cls, waiting) {
  return h('div', { class: 'live ' + cls + (text ? '' : ' thinking') }, text || waiting);
}

function renderPolishBody(sec, p, row) {
  const box = $('.polish-body', row); const r = R(p.id);
  let mode;
  if (r.busy === 'polish') mode = 'live';
  else if (r.queued && r.pipeline) mode = 'queued';
  else if (!p.polished) mode = (!aiUsable() && !readOnly) ? 'edit' : 'empty';
  else if (showDiff && !r.editPolish) mode = 'diff';
  else mode = 'edit';
  const prev = box.dataset.mode; box.dataset.mode = mode;
  if (mode === 'live') {
    if (prev !== 'live' || !$('.live', box)) box.replaceChildren(liveBox(r.liveZh, 'zh-text', '正在梳理逻辑…'));
    else refreshLive(sec, p);
    return;
  }
  if (mode === 'queued') { box.replaceChildren(liveBox('', 'zh-text', '排队中，前面还有段落在处理…')); return; }
  if (mode === 'empty') { box.replaceChildren(h('div', { class: 'placeholder' }, '写完草稿后点“润色并翻译”，这里会出现润色后的中文。')); return; }
  if (mode === 'diff') {
    const key = p.polishedFrom + '\u0000' + p.polished;
    if (prev === 'diff' && box._key === key) return;
    box._key = key;
    const v = h('div', { class: 'diffview zh-text', tabindex: '0', role: 'button', 'aria-label': '润色结果，按回车编辑', title: readOnly ? '' : '点击编辑' });
    const ops = p.polishedFrom ? diffChars(p.polishedFrom, p.polished) : null;
    if (!ops) v.textContent = p.polished;
    else ops.forEach(o => v.append(o.t === '=' ? document.createTextNode(o.s) : h(o.t === '+' ? 'ins' : 'del', {}, o.s)));
    const open = () => { if (readOnly) return; r.editPolish = true; box.dataset.mode = 'edit'; mountPolishTA(sec, p, row, box, true); };
    v.addEventListener('click', open);
    v.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
    box.replaceChildren(v);
    return;
  }
  const ta = $('textarea', box);
  if (prev !== 'edit' || !ta) mountPolishTA(sec, p, row, box, false);
  else if (document.activeElement !== ta) { ta.value = p.polished; autosize(ta); }
}
function mountPolishTA(sec, p, row, box, focus) {
  const r = R(p.id);
  const ta = makeTA('ta zh', 'pl-' + p.id, p.polished, v => { p.polished = v; touchSec(sec.id); refreshStatus(sec, p); updateCardStats(sec.id); }, '润色后的中文');
  ta.dataset.insert = '润色';
  ta.addEventListener('blur', () => { if (showDiff && r.editPolish) { r.editPolish = false; renderPolishBody(sec, p, row); } });
  box._key = null;
  box.replaceChildren(ta);
  if (readOnly) ta.readOnly = true;
  requestAnimationFrame(() => { autosize(ta); if (focus) ta.focus(); });
}
function renderNotes(p, row) {
  const ul = $('.notes', row); const r = R(p.id);
  const items = r.busy === 'polish' ? [] : p.notes;
  ul.replaceChildren(...items.map(t => h('li', {}, t)));
}
function renderEnBody(sec, p, row) {
  const box = $('.en-body', row); const r = R(p.id);
  let mode;
  if (r.busy === 'translate') mode = 'live';
  else if (r.pipeline || r.queued) mode = 'wait';
  else if (!p.en) mode = (!aiUsable() && !readOnly) ? 'edit' : 'empty';
  else mode = enPreview && !r.editEn ? 'preview' : 'edit';
  const prev = box.dataset.mode;
  const meta = $('.en-meta', row);
  if (mode === 'preview') { if (prev !== 'preview') box._key = null; renderPreviewInto(sec, p, row, box); renderEnMeta(p, meta); return; }
  box.dataset.mode = mode;
  if (mode === 'live') {
    if (prev !== 'live' || !$('.live', box)) box.replaceChildren(liveBox(r.liveEn, 'en-text', '正在翻译…'));
    else refreshLive(sec, p);
    meta.replaceChildren();
    return;
  }
  if (mode === 'wait') { box.replaceChildren(liveBox('', 'en-text', r.pipeline ? '润色完成后自动翻译' : '排队中…')); meta.replaceChildren(); return; }
  if (mode === 'empty') { box.replaceChildren(h('div', { class: 'placeholder' }, '润色完成后，这里会出现英文译文。')); meta.replaceChildren(); return; }
  const ta = $('textarea', box);
  if (prev !== 'edit' || !ta) mountEnTA(sec, p, row, box);
  else if (document.activeElement !== ta) { ta.value = p.en; autosize(ta); }
  renderEnMeta(p, meta);
}
function mountEnTA(sec, p, row, box, focus) {
  const r = R(p.id);
  const ta = makeTA('ta en', 'en-' + p.id, p.en, v => { p.en = v; touchSec(sec.id); renderEnMeta(p, $('.en-meta', row)); updateCardStats(sec.id); updatePaperStats(); }, '英文译文（LaTeX）');
  ta.dataset.insert = 'English';
  ta.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement === ta || (tool.open && tool.target === ta)) return;
      if (enPreview && r.editEn) { r.editEn = false; renderEnBody(sec, p, row); }
    }, 120);
  });
  if (readOnly) ta.readOnly = true;
  box.replaceChildren(ta);
  requestAnimationFrame(() => { autosize(ta); if (focus) ta.focus(); });
}
function renderEnMeta(p, meta) {
  if (!p.en.trim()) { meta.replaceChildren(); return; }
  const kids = [h('span', {}, fmtNum(wordCount(p.en)) + ' words')];
  if (p.polished && p.enFrom && p.polished !== p.enFrom) kids.push(h('span', { class: 'warn' }, '润色稿已改动，译文可能需要更新'));
  meta.replaceChildren(...kids);
}
function renderActions(sec, p, row) {
  const box = $('.p-actions', row); const r = R(p.id);
  box.replaceChildren();
  if (r.busy || r.queued) { const s = h('button', { class: 'btn tiny', type: 'button' }, '停止'); s.addEventListener('click', () => r.ctl && r.ctl.abort()); box.append(s); return; }
  if (readOnly) return;
  const b = (label, cls, fn) => { const x = h('button', { class: 'btn tiny ' + cls, type: 'button' }, label); x.addEventListener('click', fn); return x; };
  if (aiUsable() && isText(p)) {
    const needPolish = !p.polished || p.zh !== p.polishedFrom;
    if (needPolish) box.append(b('润色并翻译', 'primary', () => runPipeline(sec, p, 'polish')));
    else {
      const needTr = !p.en || p.polished !== p.enFrom;
      if (needTr) box.append(b('翻译', 'primary', () => runPipeline(sec, p, 'translate')));
      box.append(b('重新润色', '', () => runPipeline(sec, p, 'polish')));
      if (!needTr) box.append(b('重新翻译', '', () => runPipeline(sec, p, 'translate')));
    }
  }
  const i = sec.paragraphs.indexOf(p);
  const up = h('button', { class: 'btn ghost icon-btn', type: 'button', title: '上移', 'aria-label': '上移本段', disabled: i === 0 }, '↑');
  const down = h('button', { class: 'btn ghost icon-btn', type: 'button', title: '下移', 'aria-label': '下移本段', disabled: i === sec.paragraphs.length - 1 }, '↓');
  up.addEventListener('click', () => movePara(sec, p, -1));
  down.addEventListener('click', () => movePara(sec, p, 1));
  box.append(up, down);
  if (paper.order.length > 1) {
    const mv = h('select', { class: 'sel mv', id: 'mv-' + p.id, 'aria-label': '移到其他章节', title: '移到其他章节' },
      h('option', { value: '' }, '移到…'),
      paper.order.filter(id => id !== sec.id && sections[id]).map(id => h('option', { value: id }, `§${secIndex(id) + 1} ${clip(sections[id].titleZh.trim() || '未命名', 10)}`)));
    mv.addEventListener('change', () => { if (mv.value) moveParaToSection(sec, p, mv.value); });
    box.append(mv);
  }
  box.append(confirmBtn('删除', '确认删除', () => deletePara(sec, p), 'btn tiny ghost danger'));
}
function refreshAllRows() {
  const sec = activeSec(); if (!sec) return;
  sec.paragraphs.forEach(p => refreshPara(sec, p));
  const t = document.getElementById('secEnBtn-' + sec.id); if (t) t.hidden = !aiUsable();
}

function composer(sec) {
  const n = sec.paragraphs.length + 1;
  const ta = h('textarea', { class: 'ta zh comp-ta', id: 'compText', 'data-edit': '', spellcheck: 'false', 'aria-label': '新段落的中文草稿', placeholder: '用中文写下这一段想说的话，先把意思写清楚，不必在意措辞。' });
  ta.value = lsGet('pd:comp:' + sec.id, '');
  ta.dataset.insert = '新段落';
  ta.addEventListener('input', () => { autosize(ta); lsSet('pd:comp:' + sec.id, ta.value); });
  ta.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finishComposer(sec); } });
  const sel = pointSelect(sec, '', () => {}, 'compPoint');
  const btn = h('button', { class: 'btn primary', id: 'btnFinish', type: 'button' });
  btn.addEventListener('click', () => finishComposer(sec));
  const wrap = h('div', { class: 'composer' },
    h('div', { class: 'comp-gutter' }, h('span', { class: 'p-num', id: 'compNum' }, '¶' + n)),
    h('div', { class: 'comp-box' },
      h('div', { class: 'comp-top' }, h('b', {}, '新段落'), h('label', { class: 'pt-label', for: 'compPoint' }, h('span', {}, '对应论点'), sel)),
      ta,
      h('div', { class: 'comp-foot' }, h('span', { class: 'comp-hint', id: 'compHint' }), btn)));
  refreshComposerBtn(wrap);
  return wrap;
}
function refreshComposerBtn(root) {
  const btn = $('#btnFinish', root || document); const hint = $('#compHint', root || document);
  if (!btn) return;
  const on = aiUsable();
  btn.textContent = on ? '完成本段 · 润色并翻译' : '添加段落';
  hint.replaceChildren(...(on
    ? ['完成后先润色中文逻辑，再译成英文。快捷键 ', h('kbd', {}, '⌘/Ctrl'), ' + ', h('kbd', {}, 'Enter')]
    : ['润色与翻译暂不可用，段落会先保存为草稿。']));
}
function finishComposer(sec) {
  const ta = $('#compText'); const zh = ta.value.trim();
  if (!zh) { ta.focus(); return; }
  const p = normPara({ id: uid(), zh, point: $('#compPoint').value || '' });
  sec.paragraphs.push(p); touchSec(sec.id);
  ta.value = ''; lsDel('pd:comp:' + sec.id); autosize(ta);
  $('#compPoint').value = '';
  const empty = $('#secEmpty'); if (empty) empty.remove();
  const row = paraRow(sec, p);
  $('#paras').append(row); autosizeAll(row);
  renumber(sec); updateCardStats(sec.id); updatePaperStats();
  if (!reduceMotion) row.classList.add('flash');
  if (aiUsable()) runPipeline(sec, p, 'polish');
  ta.focus();
}
function renumber(sec) {
  const num = numbering(); let t = 0;
  sec.paragraphs.forEach(p => {
    const row = document.getElementById('para-' + p.id);
    const label = isText(p) ? '¶' + (++t) : (p.type === 'figure' ? '图 ' : '表 ') + (num.floatNo.get(p.id) || '?');
    if (row) { $('.p-num', row).textContent = label; renderActions(sec, p, row); }
  });
  const c = $('#compNum'); if (c) c.textContent = '¶' + (t + 1);
  refreshToolbar();
}
function movePara(sec, p, d) {
  const i = sec.paragraphs.indexOf(p), j = i + d;
  if (i < 0 || j < 0 || j >= sec.paragraphs.length) return;
  [sec.paragraphs[i], sec.paragraphs[j]] = [sec.paragraphs[j], sec.paragraphs[i]];
  touchSec(sec.id);
  const box = $('#paras'); sec.paragraphs.forEach(x => { const r = document.getElementById('para-' + x.id); if (r) box.append(r); });
  numCache = null; renumber(sec); updateNumbering();
  const row = document.getElementById('para-' + p.id);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
}
function deletePara(sec, p) {
  const r = R(p.id); if (r.ctl) r.ctl.abort();
  const i = sec.paragraphs.indexOf(p); if (i < 0) return;
  sec.paragraphs.splice(i, 1); touchSec(sec.id);
  if (p.type === 'figure' && p.asset) api('DELETE', `/api/papers/${paperId}/assets/${p.asset.id}`).catch(() => {});
  const row = document.getElementById('para-' + p.id); if (row) row.remove();
  numCache = null; renumber(sec); updateCardStats(sec.id); updatePaperStats(); updateNumbering();
}

function moveParaToSection(sec, p, targetId) {
  const target = sections[targetId]; const r = R(p.id);
  if (!target || r.busy || r.queued) return;
  const i = sec.paragraphs.indexOf(p); if (i < 0) return;
  sec.paragraphs.splice(i, 1); if (isText(p)) p.point = ''; target.paragraphs.push(p);
  touchSec(sec.id); touchSec(targetId);
  const row = document.getElementById('para-' + p.id); if (row) row.remove();
  numCache = null; renumber(sec); updateNumbering(); updateCardStats(sec.id); updateCardStats(targetId); updatePaperStats();
  toast(`已移到 §${secIndex(targetId) + 1} ${target.titleZh.trim() || '未命名'} 的末尾`);
}

let toastTimer;
function toast(text) {
  let el = $('#toast');
  if (!el) { el = h('div', { id: 'toast', class: 'toast', role: 'status' }); document.body.append(el); }
  el.textContent = text; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

function confirmBtn(label, confirmLabel, action, cls = 'btn tiny danger') {
  const b = h('button', { class: cls, type: 'button', 'data-edit': '' }, label); let t = null;
  b.addEventListener('click', () => {
    if (b.dataset.armed) { clearTimeout(t); action(); return; }
    b.dataset.armed = '1'; b.textContent = confirmLabel; b.classList.add('confirm');
    t = setTimeout(() => { delete b.dataset.armed; b.textContent = label; b.classList.remove('confirm'); }, 3500);
  });
  return b;
}
function applyRO(root) {
  if (!readOnly || !root) return;
  $$('[data-edit]', root).forEach(x => { if (x.tagName === 'INPUT' || x.tagName === 'TEXTAREA') x.readOnly = true; else x.disabled = true; });
}

/* ================= structural actions ================= */
function addSection() {
  if (readOnly) return;
  const s = newSection();
  sections[s.id] = s; paper.order.push(s.id);
  touchSec(s.id); touchMeta();
  activeId = s.id; lsSet(activeKey(), s.id);
  renderOutline(); renderEditor();
  requestAnimationFrame(() => { const t = document.getElementById('ct-' + s.id); if (t) { t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); t.focus(); t.select(); } });
}
function applyTemplate() {
  if (readOnly) return;
  TEMPLATE.forEach(([zh, en, pts]) => { const s = newSection(zh, en, pts); sections[s.id] = s; paper.order.push(s.id); touchSec(s.id); });
  touchMeta();
  activeId = paper.order[0]; lsSet(activeKey(), activeId);
  renderOutline(); renderEditor();
}
function moveSection(id, d) {
  const i = secIndex(id), j = i + d;
  if (i < 0 || j < 0 || j >= paper.order.length) return;
  [paper.order[i], paper.order[j]] = [paper.order[j], paper.order[i]];
  touchMeta(); renderOutline(); renderEditor();
}
function deleteSection(id) {
  const i = secIndex(id); if (i < 0) return;
  (sections[id] ? sections[id].paragraphs : []).forEach(p => { const r = R(p.id); if (r.ctl) r.ctl.abort(); });
  paper.order.splice(i, 1); delete sections[id];
  lsDel('pd:comp:' + id);
  touchSec(id); touchMeta();
  activeId = paper.order[Math.min(i, paper.order.length - 1)] || null; lsSet(activeKey(), activeId);
  renderOutline(); renderEditor();
}
async function deletePaper() {
  try {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    readOnly = true;
    await api('DELETE', '/api/papers/' + paperId);
    forgetPaper(paperId);
    lsDel(activeKey());
    location.assign('/');
  } catch (e) {
    readOnly = false;
    notice('del', '没能删除这篇论文，请检查网络后再试。');
  }
}

/* ================= numbering: figures, tables, equations, citations ================= */
const CITE_RE = /\\(cite[pt]?|citealp|citeauthor|citeyear|parencite|textcite)\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g;
const EQ_ENV_RE = /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?)\}([\s\S]*?)\\end\{\1\}/g;
let numCache = null, numVer = 0, shownSig = '', numTimer = null;
function computeNumbering() {
  const labels = new Map(), cites = new Map(), floatNo = new Map(), eqStart = new Map();
  let nf = 0, nt = 0, ne = 0;
  const addCites = src => {
    for (const m of String(src || '').matchAll(CITE_RE)) m[2].split(',').map(k => k.trim()).filter(Boolean).forEach(k => { if (!cites.has(k)) cites.set(k, cites.size + 1); });
  };
  paper.order.forEach((sid, si) => {
    const s = sections[sid]; if (!s) return;
    labels.set('sec:' + (slugBase(s.titleEn) || 's' + (si + 1)), { kind: 'sec', n: si + 1, sid });
    s.paragraphs.forEach(p => {
      if (!isText(p)) {
        const n = p.type === 'figure' ? ++nf : ++nt;
        floatNo.set(p.id, n);
        if (p.label.trim()) labels.set(p.label.trim(), { kind: p.type === 'figure' ? 'fig' : 'tab', n, sid, pid: p.id });
        addCites(p.captionEn);
        return;
      }
      eqStart.set(p.id, ne);
      const src = p.en || '';
      for (const m of src.matchAll(EQ_ENV_RE)) {
        if (m[1].endsWith('*')) continue;
        const lines = /^(equation|multline)$/.test(m[1]) ? [m[2]] : m[2].split(/\\\\/).filter(l => l.trim() && !/\\(nonumber|notag)\b/.test(l));
        lines.forEach(l => { ne++; const lb = l.match(/\\label\{([^}]+)\}/); if (lb) labels.set(lb[1].trim(), { kind: 'eq', n: ne, sid, pid: p.id }); });
      }
      addCites(src);
    });
  });
  const sig = JSON.stringify([[...labels].map(([k, v]) => k + '=' + v.n), [...cites.keys()], [...floatNo.values()].length, bib.entries.map(e => e.key)]);
  return { labels, cites, floatNo, eqStart, sig };
}
function numbering() { if (!numCache) numCache = computeNumbering(); return numCache; }
function scheduleNumbering() { clearTimeout(numTimer); numTimer = setTimeout(updateNumbering, 300); }
function updateNumbering() {
  numCache = computeNumbering();
  if (numCache.sig !== shownSig) { shownSig = numCache.sig; numVer++; refreshPreviews(); }
}
function refreshPreviews() {
  const sec = activeSec(); if (!sec) return;
  sec.paragraphs.forEach(p => {
    const row = document.getElementById('para-' + p.id); if (!row) return;
    if (isText(p)) { const box = $('.en-body', row); if (box && box.dataset.mode === 'preview') renderPreviewInto(sec, p, row, box); }
    else refreshFloatPreview(sec, p, row);
  });
  renumber(sec);
}

/* ================= LaTeX → HTML (preview) ================= */
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const escAttr = escHtml;
const safeUrl = u => (/^(https?:|mailto:)/i.test(String(u).trim()) ? String(u).trim() : '#');
const stripTex = s => String(s || '').replace(/\\[a-zA-Z]+\*?/g, '').replace(/[{}$]/g, '').replace(/~/g, ' ').replace(/\\(.)/g, '$1').replace(/\s+/g, ' ').trim();
function katexHtml(tex, display) {
  const clean = String(tex).replace(/\\label\{[^}]*\}/g, '').replace(/\\(nonumber|notag)\b/g, '');
  if (window.katex) {
    try { return window.katex.renderToString(clean, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'html' }); } catch {}
  }
  return `<code class="tex-raw">${escHtml(tex)}</code>`;
}
function readGroup(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return [src.slice(i + 1, j), j + 1]; }
  }
  return [src.slice(i + 1), src.length];
}
function readOpt(src, i) {
  if (src[i] !== '[') return [null, i];
  const j = src.indexOf(']', i);
  return j < 0 ? [null, i] : [src.slice(i + 1, j), j + 1];
}
function findDollar(src, from) {
  for (let k = from; k < src.length; k++) { if (src[k] === '\\') { k++; continue; } if (src[k] === '$') return k; }
  return -1;
}
const TEXT_WRAPS = { textbf: ['<b>', '</b>'], textit: ['<i>', '</i>'], emph: ['<em>', '</em>'], underline: ['<u>', '</u>'], texttt: ['<code>', '</code>'], textsc: ['<span class="sc">', '</span>'], textrm: ['<span>', '</span>'], textsf: ['<span>', '</span>'], mbox: ['<span>', '</span>'], text: ['<span>', '</span>'], textnormal: ['<span>', '</span>'] };
const TEXT_SIMPLE = { LaTeX: 'LaTeX', TeX: 'TeX', ldots: '…', dots: '…', textendash: '–', textemdash: '—', S: '§', textbackslash: '\\', quad: '&emsp;', qquad: '&emsp;&emsp;', noindent: '', centering: '', par: '<br><br>', newline: '<br>', item: '• ', etal: 'et al.' };
function latexToHtml(src, ctx) {
  src = String(src || '');
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '%') { const j = src.indexOf('\n', i); i = j < 0 ? n : j + 1; continue; }
    if (c === '$') {
      const dbl = src[i + 1] === '$';
      const close = dbl ? src.indexOf('$$', i + 2) : findDollar(src, i + 1);
      if (close > 0) {
        const tex = src.slice(i + (dbl ? 2 : 1), close);
        out += dbl ? `<div class="mathd">${katexHtml(tex, true)}</div>` : katexHtml(tex, false);
        i = close + (dbl ? 2 : 1); continue;
      }
      out += '$'; i++; continue;
    }
    if (c === '\\') {
      const nx = src[i + 1];
      if (nx === '(' || nx === '[') {
        const endTok = nx === '(' ? '\\)' : '\\]';
        const close = src.indexOf(endTok, i + 2);
        if (close > 0) {
          const tex = src.slice(i + 2, close);
          out += nx === '(' ? katexHtml(tex, false) : `<div class="mathd">${katexHtml(tex, true)}</div>`;
          i = close + 2; continue;
        }
      }
      if (nx && '%&#_${}'.includes(nx)) { out += escHtml(nx); i += 2; continue; }
      if (nx === '\\') { out += '<br>'; i += 2; continue; }
      if (nx === ',' || nx === ' ' || nx === ';' || nx === ':') { out += ' '; i += 2; continue; }
      const m = /^[A-Za-z]+\*?/.exec(src.slice(i + 1, i + 40));
      if (!m) { out += escHtml(c); i++; continue; }
      const cmd = m[0];
      let j = i + 1 + cmd.length;
      if (cmd === 'begin' && src[j] === '{') {
        const [env, j2] = readGroup(src, j);
        const endTag = `\\end{${env}}`;
        const close = src.indexOf(endTag, j2);
        if (close > 0 && /^(equation|align|gather|multline|eqnarray)\*?$/.test(env)) {
          const body = src.slice(j2, close);
          const base = env.replace('*', '');
          const starred = env.endsWith('*');
          let tex, count;
          if (base === 'equation' || base === 'multline') { tex = body; count = starred ? 0 : 1; }
          else { tex = `\\begin{aligned}${body.replace(/&\s*=\s*&/g, '&=')}\\end{aligned}`; count = starred ? 0 : body.split(/\\\\/).filter(l => l.trim() && !/\\(nonumber|notag)\b/.test(l)).length; }
          let tag = '';
          if (count) { const a = ctx.eq + 1, b = ctx.eq + count; ctx.eq = b; tag = `<span class="eqno">(${a === b ? a : a + '–' + b})</span>`; }
          const lbl = (body.match(/\\label\{([^}]+)\}/) || [])[1];
          out += `<div class="mathd eq"${lbl ? ` data-label="${escAttr(lbl.trim())}"` : ''}>${katexHtml(tex, true)}${tag}</div>`;
          i = close + endTag.length; continue;
        }
        if (close > 0 && (env === 'itemize' || env === 'enumerate')) {
          const tag = env === 'itemize' ? 'ul' : 'ol';
          const items = src.slice(j2, close).split(/\\item\b/).slice(1);
          out += `<${tag} class="tex-list">` + items.map(t => `<li>${latexToHtml(t.trim(), ctx)}</li>`).join('') + `</${tag}>`;
          i = close + endTag.length; continue;
        }
        out += `<code class="tex-cmd">\\begin{${escHtml(env)}}</code>`; i = j2; continue;
      }
      if (cmd === 'end' && src[j] === '{') { i = readGroup(src, j)[1]; continue; }
      if (/^(cite[pt]?\*?|citealp|parencite|textcite)$/.test(cmd)) {
        let k = j; [, k] = readOpt(src, k); [, k] = readOpt(src, k);
        if (src[k] === '{') { const [keys, k2] = readGroup(src, k); out += citeHtml(keys, cmd, ctx); i = k2; continue; }
      }
      if (/^(ref|eqref|autoref|cref|Cref|pageref)$/.test(cmd) && src[j] === '{') {
        const [lb, k2] = readGroup(src, j); out += refHtml(lb.trim(), cmd, ctx); i = k2; continue;
      }
      if (cmd === 'label' && src[j] === '{') { i = readGroup(src, j)[1]; continue; }
      if (TEXT_WRAPS[cmd] && src[j] === '{') {
        const [inner, k2] = readGroup(src, j); const [a, b] = TEXT_WRAPS[cmd];
        out += a + latexToHtml(inner, ctx) + b; i = k2; continue;
      }
      if (cmd === 'footnote' && src[j] === '{') {
        const [inner, k2] = readGroup(src, j); ctx.fn = (ctx.fn || 0) + 1;
        out += `<sup class="fn" tabindex="0" data-tip="${escAttr(stripTex(inner))}">${ctx.fn}</sup>`; i = k2; continue;
      }
      if (cmd === 'url' && src[j] === '{') {
        const [u, k2] = readGroup(src, j);
        out += `<a href="${escAttr(safeUrl(u))}" target="_blank" rel="noopener">${escHtml(u)}</a>`; i = k2; continue;
      }
      if (cmd === 'href' && src[j] === '{') {
        const [u, k2] = readGroup(src, j);
        if (src[k2] === '{') { const [t, k3] = readGroup(src, k2); out += `<a href="${escAttr(safeUrl(u))}" target="_blank" rel="noopener">${latexToHtml(t, ctx)}</a>`; i = k3; continue; }
      }
      if (cmd in TEXT_SIMPLE) { out += TEXT_SIMPLE[cmd]; i = j; if (src[i] === ' ' && /[a-z]/i.test(cmd)) i++; continue; }
      out += `<code class="tex-cmd">\\${escHtml(cmd)}</code>`; i = j; continue;
    }
    if (c === '{' || c === '}') { i++; continue; }
    if (c === '~') { out += '&nbsp;'; i++; continue; }
    if (c === '`' && src[i + 1] === '`') { out += '“'; i += 2; continue; }
    if (c === "'" && src[i + 1] === "'") { out += '”'; i += 2; continue; }
    if (c === '-' && src.startsWith('---', i)) { out += '—'; i += 3; continue; }
    if (c === '-' && src[i + 1] === '-') { out += '–'; i += 2; continue; }
    if (c === '\n') {
      if (/^\n\s*\n/.test(src.slice(i))) { out += '<br><br>'; i++; while (i < n && /\s/.test(src[i])) i++; continue; }
      out += ' '; i++; continue;
    }
    let j = i + 1;
    while (j < n && !'%$\\{}~`\'-\n'.includes(src[j])) j++;
    out += escHtml(src.slice(i, j)); i = j;
  }
  return out;
}
function citeHtml(keys, cmd, ctx) {
  const ks = keys.split(',').map(k => k.trim()).filter(Boolean);
  if (!ks.length) return '';
  const parts = ks.map(k => { const e = bibByKey(k); const no = ctx.num.cites.get(k); return { k, e, no }; });
  const missing = parts.some(x => !x.e);
  const nums = parts.map(x => (x.e ? x.no : '?')).join(', ');
  const text = /^(citet|textcite)$/.test(cmd) && parts.length === 1 && parts[0].e ? `${escHtml(shortAuthors(parts[0].e))} [${nums}]` : `[${nums}]`;
  return `<button type="button" class="cite${missing ? ' missing' : ''}" data-keys="${escAttr(ks.join(','))}">${text}</button>`;
}
function refHtml(label, cmd, ctx) {
  const t = ctx.num.labels.get(label);
  if (!t) return `<span class="xref missing" tabindex="0" data-tip="${escAttr('找不到标签 ' + label)}">??</span>`;
  const txt = cmd === 'eqref' ? `(${t.n})` : cmd === 'autoref' || cmd === 'cref' || cmd === 'Cref'
    ? ({ fig: 'Figure ', tab: 'Table ', eq: 'Eq. ', sec: 'Section ' })[t.kind] + t.n : String(t.n);
  return `<button type="button" class="xref" data-label="${escAttr(label)}">${escHtml(txt)}</button>`;
}

/* ================= bibliography (BibTeX) ================= */
let bibIndex = new Map();
function rebuildBibIndex() { bibIndex = new Map(bib.entries.map(e => [e.key, e])); }
const bibByKey = k => bibIndex.get(k);
function parseBibFields(s) {
  const f = {}; let i = 0;
  while (i < s.length) {
    const m = /^[\s,]*([A-Za-z][\w:-]*)\s*=\s*/.exec(s.slice(i)); if (!m) break;
    i += m[0].length;
    const name = m[1].toLowerCase(); let val = '';
    if (s[i] === '{') { const [v, j] = readGroup(s, i); val = v; i = j; }
    else if (s[i] === '"') {
      let j = i + 1, d = 0;
      for (; j < s.length; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === '{') d++; else if (s[j] === '}') d--; else if (s[j] === '"' && !d) break; }
      val = s.slice(i + 1, j); i = j + 1;
    } else { const m2 = /^[^,\n}]+/.exec(s.slice(i)); val = m2 ? m2[0] : ''; i += m2 ? m2[0].length : 1; }
    f[name] = val.replace(/\s+/g, ' ').trim();
  }
  return f;
}
function parseBibtex(text) {
  text = String(text || '');
  const out = []; let i = 0;
  while ((i = text.indexOf('@', i)) >= 0) {
    const m = /^@\s*([A-Za-z]+)\s*([{(])/.exec(text.slice(i, i + 80));
    if (!m) { i++; continue; }
    const type = m[1].toLowerCase(), start = i, j = i + m[0].length;
    let k = j;
    if (m[2] === '{') { let d = 1; for (; k < text.length; k++) { const ch = text[k]; if (ch === '\\') { k++; continue; } if (ch === '{') d++; else if (ch === '}') { d--; if (!d) break; } } }
    else { let d = 0; for (; k < text.length; k++) { const ch = text[k]; if (ch === '{') d++; else if (ch === '}') d--; else if (ch === ')' && !d) break; } }
    const body = text.slice(j, k); i = k + 1;
    if (['comment', 'string', 'preamble'].includes(type)) continue;
    const comma = body.indexOf(','); if (comma < 0) continue;
    const key = body.slice(0, comma).trim();
    if (!key || /[\s{}"]/.test(key)) continue;
    out.push({ key, type, raw: text.slice(start, k + 1).trim(), fields: parseBibFields(body.slice(comma + 1)) });
  }
  return out;
}
function hydrateEntry(e) {
  const parsed = parseBibtex(str(e && e.raw))[0];
  return parsed && parsed.key === e.key ? parsed : { key: str(e && e.key), type: str(e && e.type) || 'misc', raw: str(e && e.raw), fields: {} };
}
const cleanBib = v => stripTex(String(v || '').replace(/\\["'`^~=.]\{?(\w)\}?/g, '$1'));
function shortAuthors(e) {
  const list = (e.fields.author || e.fields.editor || '').split(/\s+and\s+/i).map(x => x.trim()).filter(Boolean);
  if (!list.length) return e.key;
  const last = x => cleanBib(x.includes(',') ? x.split(',')[0] : x.split(/\s+/).pop());
  if (list.length === 1) return last(list[0]);
  if (list.length === 2) return `${last(list[0])} and ${last(list[1])}`;
  return `${last(list[0])} et al.`;
}
const bibVenue = e => cleanBib(e.fields.journal || e.fields.booktitle || e.fields.publisher || e.fields.school || e.fields.howpublished || '');
const bibText = () => bib.entries.map(e => e.raw).join('\n\n') + '\n';
function afterBibChange() { rebuildBibIndex(); touchBib(); refreshToolbar(); scheduleNumbering(); }
function downloadText(name, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ================= tooltips & cross-reference jumps in previews ================= */
let tipEl = null;
function showTip(target, html) {
  if (!tipEl) { tipEl = h('div', { class: 'tip', role: 'tooltip' }); document.body.append(tipEl); }
  tipEl.innerHTML = html; tipEl.hidden = false;
  const r = target.getBoundingClientRect(); const tw = Math.min(380, window.innerWidth - 24);
  tipEl.style.maxWidth = tw + 'px';
  const left = Math.max(12, Math.min(r.left, window.innerWidth - tw - 12));
  const below = r.bottom + 8 + tipEl.offsetHeight < window.innerHeight;
  tipEl.style.left = left + 'px';
  tipEl.style.top = (below ? r.bottom + 6 : r.top - tipEl.offsetHeight - 6) + 'px';
}
function hideTip() { if (tipEl) tipEl.hidden = true; }
function tipFor(el) {
  if (el.classList.contains('cite')) {
    return el.dataset.keys.split(',').map(k => {
      const e = bibByKey(k);
      if (!e) return `<div class="tip-item missing"><code>${escHtml(k)}</code>：参考文献库里没有这条，请先导入它的 BibTeX。</div>`;
      return `<div class="tip-item"><b>[${numbering().cites.get(k) || '?'}]</b> ${escHtml(shortAuthors(e))}${e.fields.year ? ' (' + escHtml(e.fields.year) + ')' : ''}. <i>${escHtml(cleanBib(e.fields.title) || k)}</i>${bibVenue(e) ? '. ' + escHtml(bibVenue(e)) : ''}</div>`;
    }).join('');
  }
  if (el.classList.contains('xref') && el.dataset.label) {
    const t = numbering().labels.get(el.dataset.label); if (!t) return '';
    const name = { fig: 'Figure', tab: 'Table', eq: 'Equation', sec: 'Section' }[t.kind];
    let extra = '';
    if (t.pid) { const s = sections[t.sid]; const p = s && s.paragraphs.find(x => x.id === t.pid); if (p && !isText(p)) extra = escHtml(stripTex(p.captionEn || p.captionZh)); }
    if (t.kind === 'sec') extra = escHtml(sections[t.sid] ? (sections[t.sid].titleEn || sections[t.sid].titleZh) : '');
    return `<div class="tip-item"><b>${name} ${t.n}</b>${extra ? '：' + extra : ''}<div class="tip-hint">点击跳转</div></div>`;
  }
  return el.dataset.tip ? `<div class="tip-item">${escHtml(el.dataset.tip)}</div>` : '';
}
function jumpToLabel(label) {
  const t = numbering().labels.get(label); if (!t) return;
  if (t.sid !== activeId) setActive(t.sid);
  requestAnimationFrame(() => {
    let el = t.pid ? document.getElementById('para-' + t.pid) : $('.sec-head');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
    if (t.pid) { el.classList.remove('flash'); void el.offsetWidth; if (!reduceMotion) el.classList.add('flash'); }
  });
}
document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('.cite, .xref, .fn'); if (el) { const html = tipFor(el); if (html) showTip(el, html); } });
document.addEventListener('mouseout', e => { if (e.target.closest && e.target.closest('.cite, .xref, .fn')) hideTip(); });
document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('.cite, .xref, .fn'); if (el) { const html = tipFor(el); if (html) showTip(el, html); } });
document.addEventListener('focusout', e => { if (e.target.closest && e.target.closest('.cite, .xref, .fn')) hideTip(); });
document.addEventListener('click', e => {
  const x = e.target.closest && e.target.closest('.xref[data-label]');
  if (x) { e.stopPropagation(); hideTip(); jumpToLabel(x.dataset.label); return; }
  const c = e.target.closest && e.target.closest('.cite');
  if (c) { e.stopPropagation(); const html = tipFor(c); if (html) showTip(c, html); }
}, true);
window.addEventListener('scroll', hideTip, true);

/* ================= English column: interactive preview ================= */
function renderPreviewInto(sec, p, row, box) {
  const key = p.en + '\u0000' + numVer + '\u0000' + (window.katex ? 1 : 0);
  if (box.dataset.mode === 'preview' && box._key === key) return;
  box.dataset.mode = 'preview'; box._key = key;
  const num = numbering();
  const ctx = { num, eq: num.eqStart.get(p.id) || 0, fn: 0 };
  const v = h('div', { class: 'en-preview en-text', tabindex: '0', role: 'button', 'aria-label': '英文排版预览，按回车编辑 LaTeX 源码', title: readOnly ? '' : '点击编辑 LaTeX 源码' });
  v.innerHTML = latexToHtml(p.en, ctx);
  const open = e => {
    if (readOnly || (e && e.target.closest && e.target.closest('.cite, .xref, a, .fn'))) return;
    R(p.id).editEn = true; box.dataset.mode = 'edit'; mountEnTA(sec, p, row, box, true);
  };
  v.addEventListener('click', open);
  v.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === v) { e.preventDefault(); open(); } });
  box.replaceChildren(v);
}

/* ================= figure & table blocks ================= */
const assetUrls = new Map(), pdfThumbs = new Map(), floatTimers = new Map();
let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import('/vendor/pdfjs/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return m; });
  return pdfjsP;
}
function assetBlobUrl(asset) {
  if (!assetUrls.has(asset.id)) {
    assetUrls.set(asset.id, fetch(`/api/papers/${paperId}/assets/${asset.id}`, { headers: { 'x-access-code': accessCode || '' } })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(b => URL.createObjectURL(b))
      .catch(e => { assetUrls.delete(asset.id); throw e; }));
  }
  return assetUrls.get(asset.id);
}
function pdfThumb(asset, url) {
  if (!pdfThumbs.has(asset.id)) {
    pdfThumbs.set(asset.id, (async () => {
      const lib = await loadPdfjs();
      const task = lib.getDocument({ url });
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 1400 / vp1.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, viewport: vp }).promise;
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      task.destroy();
      if (!blob) throw new Error('canvas is empty');
      return URL.createObjectURL(blob);
    })().catch(e => { pdfThumbs.delete(asset.id); throw e; }));
  }
  return pdfThumbs.get(asset.id);
}
async function showAsset(media, asset) {
  try {
    const url = await assetBlobUrl(asset);
    const src = asset.mime === 'application/pdf' ? await pdfThumb(asset, url) : url;
    media.replaceChildren(h('img', { src, alt: asset.name }));
  } catch (e) { console.warn('[figure]', asset.name, e); media.replaceChildren(h('div', { class: 'placeholder' }, `图载入失败：${asset.name}`)); }
}
function mimeFromName(name) { return /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : ''; }
function checkFigFile(f) {
  if (!mimeFromName(f.name) && !['application/pdf', 'image/png', 'image/jpeg'].includes(f.type)) return '只支持 PDF、PNG、JPG。';
  if (f.size > 12 * 1024 * 1024) return '文件超过 12 MB，请压缩后再试。';
  return '';
}
async function uploadAsset(file) {
  let res;
  try {
    res = await fetch(`/api/papers/${paperId}/assets`, {
      method: 'POST', body: file,
      headers: { 'content-type': mimeFromName(file.name) || file.type, 'x-file-name': encodeURIComponent(file.name), 'x-access-code': accessCode || '' },
    });
  } catch { throw { code: 'network' }; }
  let d = null; try { d = await res.json(); } catch {}
  if (res.status === 401) { gateThenReload(); throw { code: 'unauthorized' }; }
  if (!res.ok) throw { code: (d && d.code) || 'http_' + res.status };
  return { id: d.id, name: d.name, mime: d.mime };
}
const uploadErr = e => ({ bad_type: '只支持 PDF、PNG、JPG。', bad_file: '文件内容和扩展名对不上，请换一个文件。', too_big: '文件太大。', too_many: '这篇论文的图片总量已达上限。', network: '网络中断，上传没有完成。' })[e && e.code] || '上传没有完成，请再试一次。';
const asciiSlug = s => String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
function uniqueLabel(prefix, base) {
  const used = new Set(numbering().labels.keys());
  paper.order.forEach(id => (sections[id] ? sections[id].paragraphs : []).forEach(p => { if (p.label) used.add(p.label); }));
  const stem = `${prefix}:${asciiSlug(base) || (prefix === 'fig' ? 'figure' : 'table')}`;
  let lab = stem, k = 2;
  while (used.has(lab)) lab = `${stem}-${k++}`;
  return lab;
}
function schedFloat(sec, p, row) {
  clearTimeout(floatTimers.get(p.id));
  floatTimers.set(p.id, setTimeout(() => refreshFloatPreview(sec, p, row, true), 250));
}
function floatRow(sec, p) {
  const row = h('article', { class: 'para float', id: 'para-' + p.id, 'data-id': p.id },
    h('div', { class: 'p-gutter' }, h('span', { class: 'p-num' }), h('span', { class: 'pill' })),
    h('div', { class: 'cell c-float' }),
    h('div', { class: 'cell c-en' }, h('span', { class: 'cell-label' }, '预览'), h('div', { class: 'float-preview' })),
    h('div', { class: 'p-foot' }, h('span', { class: 'p-msg', role: 'status' }), h('div', { class: 'p-actions' })),
  );
  $('.c-float', row).append(p.type === 'figure' ? figureEditor(sec, p, row) : tableEditor(sec, p, row));
  refreshPara(sec, p, row);
  return row;
}
function captionFields(sec, p, row, label) {
  const zh = makeTA('ta zh cap', 'cz-' + p.id, p.captionZh, v => { p.captionZh = v; touchSec(sec.id); refreshStatus(sec, p, row); if (!p.captionEn.trim()) schedFloat(sec, p, row); }, label + '（中文）');
  zh.dataset.insert = label; zh.placeholder = `${label}（中文）`;
  const en = makeTA('ta en cap', 'ce-' + p.id, p.captionEn, v => { p.captionEn = v; touchSec(sec.id); refreshStatus(sec, p, row); schedFloat(sec, p, row); }, `English ${label}`);
  en.dataset.insert = 'English ' + label; en.placeholder = 'English caption';
  const tr = h('button', { class: 'btn tiny', type: 'button', id: 'ctr-' + p.id, 'data-edit': '' }, '译成英文');
  tr.addEventListener('click', () => translateCaption(sec, p));
  if (!aiUsable()) tr.hidden = true;
  const lb = h('input', { class: 'inp mono lbl-in', id: 'lb-' + p.id, 'data-edit': '', 'aria-label': '交叉引用标签', placeholder: p.type === 'figure' ? 'fig:xxx' : 'tab:xxx', value: p.label });
  const hint = h('code', { class: 'ref-hint' }, `\\ref{${p.label || '…'}}`);
  lb.addEventListener('input', () => { p.label = lb.value.trim(); hint.textContent = `\\ref{${p.label || '…'}}`; touchSec(sec.id); });
  return [
    h('div', { class: 'fe-cap' }, zh, tr),
    en,
    h('div', { class: 'fe-row' }, h('label', { class: 'lbl', for: 'lb-' + p.id }, '标签'), lb, h('span', { class: 'help' }, '正文里写'), hint, h('span', { class: 'help' }, '引用它')),
  ];
}
function figureEditor(sec, p, row) {
  const wrap = h('div', { class: 'float-ed' });
  const file = h('input', { type: 'file', id: 'ff-' + p.id, accept: '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hidden: true });
  const chip = h('span', { class: 'file-chip' }, p.asset ? [h('span', { class: 'imp-kind' }, p.asset.mime === 'application/pdf' ? 'PDF' : p.asset.mime === 'image/png' ? 'PNG' : 'JPG'), ' ', p.asset.name] : '还没有选择文件');
  const pick = h('button', { class: 'btn tiny', type: 'button', 'data-edit': '' }, p.asset ? '更换文件' : '选择文件');
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    const err = checkFigFile(f); if (err) { R(p.id).err = err; refreshStatus(sec, p, row); return; }
    pick.disabled = true; pick.textContent = '上传中…';
    try {
      const old = p.asset; p.asset = await uploadAsset(f); R(p.id).err = '';
      if (old) api('DELETE', `/api/papers/${paperId}/assets/${old.id}`).catch(() => {});
      touchSec(sec.id);
      chip.replaceChildren(h('span', { class: 'imp-kind' }, p.asset.mime === 'application/pdf' ? 'PDF' : p.asset.mime === 'image/png' ? 'PNG' : 'JPG'), ' ', p.asset.name);
      refreshFloatPreview(sec, p, row, true);
    } catch (e) { R(p.id).err = uploadErr(e); }
    pick.disabled = false; pick.textContent = '更换文件'; refreshStatus(sec, p, row);
  });
  const width = h('select', { class: 'sel', id: 'fw-' + p.id, 'data-edit': '', 'aria-label': '图宽' },
    [['0.5', '半栏宽'], ['0.7', '0.7 栏宽'], ['0.8', '0.8 栏宽'], ['1', '整栏宽']].map(([v, t]) => h('option', { value: v }, t)));
  width.value = String(p.width);
  if (width.value !== String(p.width)) { width.append(h('option', { value: String(p.width) }, `${p.width} 栏宽`)); width.value = String(p.width); }
  width.addEventListener('change', () => { p.width = Number(width.value); touchSec(sec.id); refreshFloatPreview(sec, p, row, true); });
  wrap.append(h('div', { class: 'fe-top' }, h('b', {}, '图'), chip, pick, file, h('label', { class: 'lbl', for: 'fw-' + p.id }, '宽度'), width), ...captionFields(sec, p, row, '图注'));
  return wrap;
}
function tableEditor(sec, p, row) {
  const wrap = h('div', { class: 'float-ed' });
  const draw = () => {
    const seg = segControl([['grid', '可视化编辑'], ['latex', 'LaTeX']], p.mode, v => {
      if (v === 'latex' && !p.latex.trim()) p.latex = gridTabular(p.grid, '');
      p.mode = v; touchSec(sec.id); draw(); refreshFloatPreview(sec, p, row, true);
    }, '表格编辑方式');
    let body;
    if (p.mode === 'grid') body = gridEditor(sec, p, row, draw);
    else {
      body = makeTA('ta mono tex', 'tl-' + p.id, p.latex, v => { p.latex = v; touchSec(sec.id); schedFloat(sec, p, row); }, '表格的 LaTeX 代码');
      body.placeholder = '\\begin{tabular}{lcc} ... \\end{tabular}';
    }
    wrap.replaceChildren(h('div', { class: 'fe-top' }, h('b', {}, '表'), seg), body, ...captionFields(sec, p, row, '表注'));
    applyRO(wrap); autosizeAll(wrap);
  };
  draw();
  return wrap;
}
function gridEditor(sec, p, row, redraw) {
  const g = p.grid; const nr = g.rows.length, nc = g.rows[0].length;
  const after = () => { touchSec(sec.id); redraw(); refreshFloatPreview(sec, p, row, true); };
  const tbl = h('table', { class: 'grid-ed' });
  tbl.append(h('thead', {}, h('tr', {}, h('th', {}), ...g.align.map((a, c) => {
    const s = h('select', { class: 'sel tiny', id: `ga-${p.id}-${c}`, 'data-edit': '', 'aria-label': `第 ${c + 1} 列对齐` }, [['l', '左'], ['c', '中'], ['r', '右']].map(([v, t]) => h('option', { value: v }, t)));
    s.value = a; s.addEventListener('change', () => { g.align[c] = s.value; touchSec(sec.id); schedFloat(sec, p, row); });
    return h('th', {}, s);
  }))));
  const tb = h('tbody');
  g.rows.forEach((r, ri) => tb.append(h('tr', { class: g.header && ri === 0 ? 'hdr' : '' }, h('td', { class: 'rh' }, String(ri + 1)), ...r.map((v, ci) => {
    const inp = h('input', { class: 'cell-in', id: `g-${p.id}-${ri}-${ci}`, 'data-edit': '', 'aria-label': `第 ${ri + 1} 行第 ${ci + 1} 列`, value: v });
    inp.addEventListener('input', () => { g.rows[ri][ci] = inp.value; touchSec(sec.id); schedFloat(sec, p, row); });
    inp.addEventListener('paste', e => {
      const t = e.clipboardData && e.clipboardData.getData('text/plain');
      if (t && /[\t\n]/.test(t.replace(/\n+$/, ''))) { e.preventDefault(); pasteGrid(g, ri, ci, t); after(); toast('已从剪贴板填入表格'); }
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const nx = document.getElementById(`g-${p.id}-${ri + 1}-${ci}`); if (nx) nx.focus(); }
    });
    return h('td', {}, inp);
  }))));
  tbl.append(tb);
  const b = (t, fn, dis) => { const x = h('button', { class: 'btn tiny ghost', type: 'button', 'data-edit': '', disabled: dis }, t); x.addEventListener('click', () => { fn(); after(); }); return x; };
  const hdr = h('input', { type: 'checkbox', id: 'gh-' + p.id, 'data-edit': '' }); hdr.checked = g.header;
  hdr.addEventListener('change', () => { g.header = hdr.checked; after(); });
  return h('div', { class: 'grid-box' },
    h('div', { class: 'grid-wrap' }, tbl),
    h('div', { class: 'fe-row' },
      b('+ 行', () => g.rows.push(Array(nc).fill('')), nr >= 40), b('− 行', () => g.rows.pop(), nr <= 1),
      b('+ 列', () => { g.rows.forEach(r => r.push('')); g.align.push('c'); }, nc >= 16), b('− 列', () => { g.rows.forEach(r => r.pop()); g.align.pop(); }, nc <= 1),
      h('label', { class: 'toggle', for: 'gh-' + p.id }, hdr, '首行是表头'),
      h('span', { class: 'help' }, '可以从 Excel 或 Google 表格复制一块区域，粘贴到任意格子。单元格里可以写 $公式$。')));
}
function pasteGrid(g, r0, c0, text) {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map(l => l.split('\t'));
  while (g.rows.length < Math.min(40, r0 + lines.length)) g.rows.push(Array(g.rows[0].length).fill(''));
  const nc = Math.min(16, Math.max(g.rows[0].length, c0 + Math.max(...lines.map(l => l.length))));
  g.rows.forEach(r => { while (r.length < nc) r.push(''); });
  while (g.align.length < nc) g.align.push('c');
  lines.forEach((l, i) => l.forEach((v, j) => { if (g.rows[r0 + i] && c0 + j < nc) g.rows[r0 + i][c0 + j] = v.trim(); }));
}
const texCell = s => String(s || '').split(/(\$[^$]*\$)/).map((part, i) => (i % 2 ? part : part.replace(/(?<!\\)([%&#_])/g, '\\$1'))).join('');
function gridTabular(g, indent) {
  const lines = g.rows.map(r => `${indent}  ${r.map(texCell).join(' & ')} \\\\`);
  return [
    `${indent}\\begin{tabular}{${g.align.join('')}}`,
    `${indent}  \\toprule`,
    ...(g.header && lines.length > 1 ? [lines[0], `${indent}  \\midrule`, ...lines.slice(1)] : lines),
    `${indent}  \\bottomrule`,
    `${indent}\\end{tabular}`,
  ].join('\n');
}
function gridHtml(g, ctx) {
  const cell = (tag, v, c) => `<${tag} class="al-${g.align[c] || 'c'}">${latexToHtml(v, ctx)}</${tag}>`;
  const rows = g.rows.map((r, ri) => `<tr>${r.map((v, c) => cell(g.header && ri === 0 ? 'th' : 'td', v, c)).join('')}</tr>`);
  return `<table class="tex-table">${g.header && rows.length > 1 ? `<thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody>` : `<tbody>${rows.join('')}</tbody>`}</table>`;
}
function splitCells(row) {
  const out = []; let cur = '', d = 0, math = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\') { cur += c + (row[i + 1] || ''); i++; continue; }
    if (c === '$') math = !math;
    if (c === '{') d++; else if (c === '}') d--;
    if (c === '&' && !d && !math) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
function tabularHtml(src, ctx) {
  const m = /\\begin\{(tabular[x*]?)\}(?:\{[^}]*\})?\{((?:[^{}]|\{[^{}]*\})*)\}([\s\S]*?)\\end\{\1\}/.exec(src);
  if (!m) return src.trim() ? `<pre class="tex-raw">${escHtml(src)}</pre>` : '<div class="placeholder">在左边粘贴 tabular 代码</div>';
  const spec = m[2].replace(/p\{[^}]*\}|m\{[^}]*\}|b\{[^}]*\}|X/g, 'l').replace(/[^lcr]/g, '').split('');
  let body = m[3].replace(/\\cmidrule(\([^)]*\))?\{[^}]*\}|\\cline\{[^}]*\}|\\(toprule|bottomrule|hline)\b/g, '');
  const mid = body.search(/\\midrule\b/);
  const headCount = mid >= 0 ? body.slice(0, mid).split(/\\\\/).filter(r => r.trim()).length : 0;
  body = body.replace(/\\midrule\b/g, '');
  const rows = body.split(/\\\\(?:\[[^\]]*\])?/).map(r => r.trim()).filter(Boolean);
  const html = rows.map((r, ri) => {
    const tag = ri < headCount ? 'th' : 'td'; let col = 0;
    return '<tr>' + splitCells(r).map(cell => {
      const mc = /^\\multicolumn\{(\d+)\}\{([^}]*)\}\{([\s\S]*)\}$/.exec(cell);
      if (mc) { const span = Number(mc[1]); col += span; return `<${tag} colspan="${span}" class="al-${(mc[2].match(/[lcr]/) || ['c'])[0]}">${latexToHtml(mc[3], ctx)}</${tag}>`; }
      const al = spec[col++] || 'c';
      return `<${tag} class="al-${al}">${latexToHtml(cell, ctx)}</${tag}>`;
    }).join('') + '</tr>';
  });
  return `<table class="tex-table"><thead>${html.slice(0, headCount).join('')}</thead><tbody>${html.slice(headCount).join('')}</tbody></table>`;
}
function floatCaption(p) {
  if (p.captionEn.trim()) return { text: p.captionEn.trim(), en: true };
  if (p.type === 'table' && p.mode === 'latex') { const m = /\\caption\{/.exec(p.latex); if (m) return { text: readGroup(p.latex, m.index + 8)[0], en: true }; }
  return { text: p.captionZh.trim(), en: false };
}
function refreshFloatPreview(sec, p, row, force) {
  row = row || document.getElementById('para-' + p.id); if (!row) return;
  const box = $('.float-preview', row); if (!box) return;
  const key = JSON.stringify(paraBody(p)) + '|' + numVer + '|' + (window.katex ? 1 : 0);
  if (!force && box._key === key) return;
  box._key = key;
  const num = numbering(); const ctx = { num, eq: 0, fn: 0 };
  const n = num.floatNo.get(p.id) || '?';
  const capInfo = floatCaption(p);
  const cap = h('div', { class: 'fcap' });
  cap.innerHTML = `<b>${p.type === 'figure' ? 'Figure' : 'Table'} ${n}:</b> ` + (capInfo.text
    ? (capInfo.en ? latexToHtml(capInfo.text, ctx) : `<span class="muted">${escHtml(capInfo.text)}</span>`)
    : '<span class="muted">还没有写图注</span>');
  if (p.type === 'figure') {
    const media = h('div', { class: 'fig-media' });
    media.style.width = Math.round(p.width * 100) + '%';
    if (!p.asset) media.append(h('div', { class: 'placeholder' }, '还没有选择图片或 PDF'));
    else { media.append(h('div', { class: 'fig-loading' }, '正在载入图…')); showAsset(media, p.asset); }
    box.replaceChildren(media, cap);
  } else {
    const t = h('div', { class: 'tbl-wrap' });
    t.innerHTML = p.mode === 'grid' ? gridHtml(p.grid, ctx) : tabularHtml(p.latex, ctx);
    box.replaceChildren(cap, t);
  }
}
async function translateCaption(sec, p) {
  if (!p.captionZh.trim() || !(await aiReady())) return;
  const r = R(p.id); if (r.busy) return;
  r.busy = 'caption'; r.err = '';
  const btn = document.getElementById('ctr-' + p.id); if (btn) { btn.disabled = true; btn.textContent = '翻译中…'; }
  try {
    const { text } = await streamAI('caption', { paper: { field: paper.field, spelling: paper.spelling, glossary: glossary() }, text: p.captionZh });
    const en = cleanEn(text).replace(/^(figure|fig\.|table)\s*\d*\s*[:.：]\s*/i, '').replace(/\n+/g, ' ').trim();
    if (en) { p.captionEn = en; p.captionFrom = p.captionZh; touchSec(sec.id); syncValue('ce-' + p.id, en); }
  } catch (e) { handleAIError(p, e); }
  finally {
    r.busy = null;
    const b2 = document.getElementById('ctr-' + p.id); if (b2) { b2.disabled = false; b2.textContent = '译成英文'; }
    const row = document.getElementById('para-' + p.id); if (row) { refreshStatus(sec, p, row); refreshFloatPreview(sec, p, row, true); }
  }
}
function insertBlock(sec, p) {
  const target = tool.target && tool.target.isConnected ? tool.target.closest('.para') : null;
  const afterId = target && target.dataset.id;
  const idx = afterId ? sec.paragraphs.findIndex(x => x.id === afterId) : -1;
  if (idx >= 0) sec.paragraphs.splice(idx + 1, 0, p); else sec.paragraphs.push(p);
  touchSec(sec.id);
  numCache = null;
  const el = paraRow(sec, p);
  if (idx >= 0) document.getElementById('para-' + afterId).after(el); else $('#paras').append(el);
  const empty = $('#secEmpty'); if (empty) empty.remove();
  renumber(sec); updateCardStats(sec.id); autosizeAll(el); updateNumbering();
  el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  if (!reduceMotion) el.classList.add('flash');
}

/* ================= insert toolbar ================= */
const tool = { open: null, target: null, sel: null };
function targetText() {
  const t = tool.target;
  if (!t || !t.isConnected || t.id === 'compText') return '新段落';
  const row = t.closest('.para');
  const num = row ? $('.p-num', row).textContent : '';
  return `${num} ${t.dataset.insert || ''}`.trim();
}
function refreshToolbar() {
  const b = $('.tb-btn[data-tool="bib"]'); if (b) b.textContent = `参考文献库 · ${bib.entries.length}`;
  const t = $('#tbTarget'); if (t) t.textContent = '插入到：' + targetText();
}
document.addEventListener('focusin', e => {
  const t = e.target;
  if (t && t.matches && t.matches('textarea[data-insert]')) { tool.target = t; tool.sel = { start: t.selectionStart, end: t.selectionEnd }; refreshToolbar(); }
});
['select', 'keyup', 'mouseup', 'input'].forEach(ev => document.addEventListener(ev, e => {
  if (e.target === tool.target) tool.sel = { start: e.target.selectionStart, end: e.target.selectionEnd };
}, true));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tool.open) closeTool(); });
// 点工具栏以外的地方就收起面板；点正文输入框不收起，方便先换插入位置再插入。
document.addEventListener('mousedown', e => {
  if (!tool.open || !(e.target instanceof Element)) return;
  if (e.target.closest('#tdock, .tip, textarea[data-insert]')) return;
  closeTool();
});
function insertText(text) {
  let t = tool.target && tool.target.isConnected ? tool.target : $('#compText');
  if (!t) { toast('先点一下要插入的位置。'); return false; }
  const same = t === tool.target && tool.sel;
  const start = same ? tool.sel.start : t.value.length;
  const end = same ? tool.sel.end : start;
  t.focus();
  t.setRangeText(text, start, end, 'end');
  t.dispatchEvent(new Event('input', { bubbles: true }));
  tool.target = t; tool.sel = { start: t.selectionStart, end: t.selectionEnd };
  return true;
}
function toolDock() {
  const btn = (k, label, title) => {
    const b = h('button', { class: 'tb-btn', type: 'button', 'data-tool': k, title, 'aria-expanded': 'false' }, label);
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => openTool(k));
    return b;
  };
  return h('div', { class: 'tdock', id: 'tdock' },
    h('div', { class: 'tbar', role: 'toolbar', 'aria-label': '插入工具' },
      btn('figure', '插图', '插入图片或 PDF 图'), btn('table', '表格', '插入表格'), btn('math', '公式', '插入数学公式'), btn('cite', '引用', '插入参考文献引用'),
      h('span', { class: 'tb-sep' }),
      btn('bib', `参考文献库 · ${bib.entries.length}`, '导入、导出 BibTeX'),
      h('span', { class: 'tb-target', id: 'tbTarget' }, '插入到：' + targetText())),
    h('div', { class: 'tpop', id: 'tpop', hidden: true }));
}
function openTool(k) {
  const pop = $('#tpop'); if (!pop) return;
  if (tool.open === k) { closeTool(); return; }
  tool.open = k; pop.hidden = false;
  $$('.tb-btn').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.tool === k)));
  ({ figure: figureTool, table: tableTool, math: mathTool, cite: citeTool, bib: bibTool })[k](pop);
}
function closeTool() {
  tool.open = null;
  const pop = $('#tpop'); if (pop) { pop.hidden = true; pop.replaceChildren(); }
  $$('.tb-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function toolHead(title, sub) {
  const x = h('button', { class: 'btn ghost icon-btn', type: 'button', title: '关闭', 'aria-label': '关闭' }, '×');
  x.addEventListener('click', closeTool);
  return h('div', { class: 'tp-head' }, h('b', {}, title), sub ? h('span', { class: 'help' }, sub) : null, x);
}
const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function figureTool(pop) {
  const file = h('input', { type: 'file', id: 'figFile', accept: '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg', hidden: true });
  const pick = h('button', { class: 'btn', type: 'button' }, '选择图片或 PDF');
  const info = h('span', { class: 'help' }, 'PDF、PNG、JPG，单个不超过 12 MB。矢量图建议用 PDF。');
  const cap = h('textarea', { class: 'inp', id: 'figCap', rows: '2', placeholder: '图注（中文，可以稍后再写）' });
  const width = h('select', { class: 'sel', id: 'figWidth' }, [['0.5', '半栏宽'], ['0.8', '0.8 栏宽'], ['1', '整栏宽']].map(([v, t]) => h('option', { value: v }, t)));
  width.value = '0.8';
  const go = h('button', { class: 'btn primary', type: 'button', disabled: true }, '插入图');
  let chosen = null;
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files[0]; if (!f) return;
    const err = checkFigFile(f);
    if (err) { info.textContent = err; info.classList.add('bad'); chosen = null; go.disabled = true; return; }
    chosen = f; info.textContent = `${f.name} · ${fmtSize(f.size)}`; info.classList.remove('bad'); go.disabled = false;
  });
  go.addEventListener('click', async () => {
    if (!chosen) return;
    go.disabled = true; go.textContent = '上传中…';
    try {
      const asset = await uploadAsset(chosen);
      const sec = activeSec();
      const p = normPara({ id: uid(), type: 'figure', asset, width: Number(width.value), captionZh: cap.value.trim(), label: uniqueLabel('fig', chosen.name) });
      closeTool(); insertBlock(sec, p);
      if (p.captionZh && aiUsable()) translateCaption(sec, p);
    } catch (e) { info.textContent = uploadErr(e); info.classList.add('bad'); go.disabled = false; go.textContent = '插入图'; }
  });
  pop.replaceChildren(toolHead('插入图', '插在当前段落之后'),
    h('div', { class: 'tp-row' }, pick, file, info),
    h('div', { class: 'tp-row' }, h('label', { class: 'lbl', for: 'figWidth' }, '宽度'), width),
    cap,
    h('div', { class: 'tp-row end' }, h('span', { class: 'help grow' }, '导出到 Overleaf 时，文件会放进 figures 文件夹，并自动写好 \\includegraphics。'), go));
}
function tableTool(pop) {
  let mode = 'grid';
  const rows = h('input', { class: 'inp num', id: 'tbRows', type: 'number', min: '1', max: '40', value: '4' });
  const cols = h('input', { class: 'inp num', id: 'tbCols', type: 'number', min: '1', max: '16', value: '3' });
  const latex = h('textarea', { class: 'inp mono', id: 'tbLatex', rows: '6', hidden: true, placeholder: '粘贴 LaTeX：可以只是 tabular，也可以是完整的 table 环境' });
  const gridRow = h('div', { class: 'tp-row' }, h('label', { class: 'lbl', for: 'tbRows' }, '行'), rows, h('label', { class: 'lbl', for: 'tbCols' }, '列'), cols,
    h('span', { class: 'help' }, '插入后直接在表格里编辑；也可以从 Excel 复制一块区域粘贴进去。'));
  const seg = segControl([['grid', '可视化编辑'], ['latex', '粘贴 LaTeX']], mode, v => { mode = v; gridRow.hidden = v !== 'grid'; latex.hidden = v !== 'latex'; if (v === 'latex') latex.focus(); }, '表格方式');
  const cap = h('textarea', { class: 'inp', id: 'tbCap', rows: '2', placeholder: '表注（中文，可以稍后再写）' });
  const go = h('button', { class: 'btn primary', type: 'button' }, '插入表格');
  go.addEventListener('click', () => {
    const sec = activeSec(); if (!sec) return;
    let p;
    if (mode === 'latex') {
      const src = latex.value.trim(); if (!src) { latex.focus(); return; }
      p = normPara({ id: uid(), type: 'table', mode: 'latex', latex: src, captionZh: cap.value.trim(), label: (src.match(/\\label\{([^}]+)\}/) || [])[1] || uniqueLabel('tab', 'table') });
    } else {
      const r = clampInt(rows.value, 1, 40, 4), c = clampInt(cols.value, 1, 16, 3);
      p = normPara({ id: uid(), type: 'table', mode: 'grid', grid: { rows: Array.from({ length: r }, () => Array(c).fill('')), header: true }, captionZh: cap.value.trim(), label: uniqueLabel('tab', 'table') });
    }
    closeTool(); insertBlock(sec, p);
    if (p.captionZh && aiUsable()) translateCaption(sec, p);
    if (p.mode === 'grid') requestAnimationFrame(() => { const c0 = document.getElementById(`g-${p.id}-0-0`); if (c0) c0.focus(); });
  });
  pop.replaceChildren(toolHead('插入表格', '插在当前段落之后'), seg, gridRow, latex, cap, h('div', { class: 'tp-row end' }, go));
}
function mathTool(pop) {
  let mode = 'inline';
  const ta = h('textarea', { class: 'inp mono', id: 'mathSrc', rows: '3', spellcheck: 'false', placeholder: '例如  \\hat{y}_{t+1} = f(\\mathbf{X}_{t-T:t}, \\mathcal{G})' });
  const pv = h('div', { class: 'math-pv', 'aria-live': 'polite' });
  const lbl = h('input', { class: 'inp mono', id: 'mathLabel', placeholder: '标签（可选）：eq:loss', hidden: true });
  const upd = () => { pv.innerHTML = ta.value.trim() ? katexHtml(ta.value, mode === 'display') : '<span class="help">预览会显示在这里</span>'; };
  const seg = segControl([['inline', '行内公式 $…$'], ['display', '独立公式（带编号）']], mode, v => { mode = v; lbl.hidden = v !== 'display'; upd(); }, '公式类型');
  const snippets = [['分式', '\\frac{a}{b}'], ['上标', 'x^{2}'], ['下标', 'x_{i}'], ['根号', '\\sqrt{x}'], ['求和', '\\sum_{i=1}^{N} '], ['积分', '\\int_{a}^{b} f(x)\\,\\mathrm{d}x'], ['向量', '\\mathbf{x}'], ['矩阵', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'], ['argmin', '\\arg\\min_{\\theta} '], ['范数', '\\lVert x \\rVert_2'], ['期望', '\\mathbb{E}\\left[ x \\right]'], ['集合', '\\mathcal{G} = (\\mathcal{V}, \\mathcal{E})']];
  const sn = h('div', { class: 'snips' }, snippets.map(([t, v]) => {
    const b = h('button', { class: 'btn tiny ghost', type: 'button', title: v }, t);
    b.addEventListener('click', () => { ta.setRangeText(v, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); upd(); });
    return b;
  }));
  ta.addEventListener('input', upd);
  const go = h('button', { class: 'btn primary', type: 'button' }, '插入公式');
  go.addEventListener('click', () => {
    const tex = ta.value.trim(); if (!tex) { ta.focus(); return; }
    const label = lbl.value.trim();
    const text = mode === 'inline' ? `$${tex}$` : `\n\\begin{equation}\n  ${tex}${label ? `\n  \\label{${label}}` : ''}\n\\end{equation}\n`;
    if (insertText(text)) closeTool();
  });
  ta.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); go.click(); } });
  pop.replaceChildren(toolHead('插入公式', '会插到：' + targetText()), h('div', { class: 'tp-row' }, seg, lbl), sn, h('div', { class: 'math-grid' }, ta, pv),
    h('div', { class: 'tp-row end' }, h('span', { class: 'help grow' }, '在草稿里插入公式后，润色和翻译都会原样保留它。'), go));
  upd(); setTimeout(() => ta.focus(), 0);
}
function citeTool(pop) {
  const chosen = new Set();
  const q = h('input', { class: 'inp', id: 'citeQ', placeholder: '搜索作者、标题、年份或 key', autocomplete: 'off' });
  const cmd = h('select', { class: 'sel', id: 'citeCmd', 'aria-label': '引用命令' }, [['cite', '\\cite'], ['citep', '\\citep'], ['citet', '\\citet']].map(([v, t]) => h('option', { value: v }, t)));
  const list = h('ul', { class: 'cite-list', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': '参考文献' });
  const go = h('button', { class: 'btn primary', type: 'button', disabled: true }, '插入引用');
  const label = () => { go.disabled = !chosen.size; go.textContent = chosen.size ? `插入 \\${cmd.value}{${[...chosen].join(',')}}` : '插入引用'; };
  const cited = numbering().cites;
  const draw = () => {
    const term = q.value.trim().toLowerCase();
    const items = bib.entries.filter(e => !term || `${e.key} ${e.fields.author || ''} ${e.fields.title || ''} ${e.fields.year || ''}`.toLowerCase().includes(term)).slice(0, 300);
    list.replaceChildren(...items.map(e => {
      const on = chosen.has(e.key);
      const li = h('li', { role: 'option', 'aria-selected': String(on), tabindex: '0', class: on ? 'on' : '' },
        h('span', { class: 'ck', 'aria-hidden': 'true' }),
        h('div', { class: 'ce' }, h('div', { class: 'ct' }, cleanBib(e.fields.title) || e.key),
          h('div', { class: 'cm' }, `${shortAuthors(e)} · ${e.fields.year || 'n.d.'} · `, h('code', {}, e.key), cited.has(e.key) ? h('span', { class: 'badge' }, `已引用 [${cited.get(e.key)}]`) : null)));
      const tog = () => { if (chosen.has(e.key)) chosen.delete(e.key); else chosen.add(e.key); draw(); label(); };
      li.addEventListener('click', tog);
      li.addEventListener('keydown', ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); tog(); } });
      return li;
    }));
    if (!items.length) list.append(h('li', { class: 'empty' }, bib.entries.length ? '没有匹配的文献。' : '参考文献库还是空的。先点「管理参考文献库」导入 BibTeX。'));
  };
  q.addEventListener('input', draw);
  q.addEventListener('keydown', e => { if (e.key === 'Enter' && chosen.size) { e.preventDefault(); go.click(); } });
  cmd.addEventListener('change', label);
  go.addEventListener('click', () => { if (chosen.size && insertText(`\\${cmd.value}{${[...chosen].join(',')}}`)) closeTool(); });
  const lib = h('button', { class: 'btn tiny', type: 'button' }, '管理参考文献库');
  lib.addEventListener('click', () => { tool.open = null; openTool('bib'); });
  pop.replaceChildren(toolHead('插入引用', '可以多选 · 会插到：' + targetText()), h('div', { class: 'tp-row' }, q, cmd), list, h('div', { class: 'tp-row end' }, lib, h('span', { class: 'grow' }), go));
  draw(); setTimeout(() => q.focus(), 0);
}
function bibTool(pop) {
  const file = h('input', { type: 'file', id: 'bibFile', accept: '.bib,.txt,text/plain', hidden: true });
  const pick = h('button', { class: 'btn', type: 'button', 'data-edit': '' }, '导入 .bib 文件');
  const exp = h('button', { class: 'btn', type: 'button' }, '导出 references.bib');
  const paste = h('textarea', { class: 'inp mono', id: 'bibPaste', rows: '4', 'data-edit': '', spellcheck: 'false', placeholder: '也可以把 BibTeX 粘贴到这里，例如从 Google Scholar、Zotero、知网导出的条目' });
  const add = h('button', { class: 'btn tiny', type: 'button', 'data-edit': '' }, '导入粘贴的内容');
  const msg = h('p', { class: 'exp-msg', role: 'status' });
  const q = h('input', { class: 'inp', id: 'bibQ', placeholder: '搜索', autocomplete: 'off' });
  const list = h('ul', { class: 'bib-list' });
  const head = toolHead(`参考文献库 · ${bib.entries.length} 条`, '导出 Overleaf 项目时会一起带上 references.bib');
  const cited = numbering().cites;
  const draw = () => {
    $('b', head).textContent = `参考文献库 · ${bib.entries.length} 条`;
    exp.disabled = !bib.entries.length;
    const term = q.value.trim().toLowerCase();
    const items = bib.entries.filter(e => !term || `${e.key} ${e.fields.author || ''} ${e.fields.title || ''} ${e.fields.year || ''}`.toLowerCase().includes(term));
    list.replaceChildren(...items.map(e => {
      const del = confirmBtn('删除', '确认删除', () => { bib.entries = bib.entries.filter(y => y.key !== e.key); afterBibChange(); draw(); }, 'btn tiny ghost danger');
      return h('li', {}, h('div', { class: 'ce' }, h('div', { class: 'ct' }, cleanBib(e.fields.title) || e.key),
        h('div', { class: 'cm' }, `${shortAuthors(e)} · ${e.fields.year || 'n.d.'}${bibVenue(e) ? ' · ' + bibVenue(e) : ''} · `, h('code', {}, e.key), cited.has(e.key) ? h('span', { class: 'badge' }, `已引用 [${cited.get(e.key)}]`) : null)),
        readOnly ? null : del);
    }));
    if (!items.length) list.append(h('li', { class: 'empty' }, bib.entries.length ? '没有匹配的文献。' : '还没有文献。导入 .bib 文件，或粘贴 BibTeX。'));
  };
  const doImport = text => {
    const items = parseBibtex(text);
    if (!items.length) { msg.textContent = '没有识别出 BibTeX 条目，请检查格式（每条以 @article{key, 这样的形式开头）。'; msg.classList.add('bad'); return; }
    let added = 0, updated = 0;
    items.forEach(it => { const i = bib.entries.findIndex(e => e.key === it.key); if (i >= 0) { bib.entries[i] = it; updated++; } else { bib.entries.push(it); added++; } });
    afterBibChange();
    msg.classList.remove('bad');
    msg.textContent = `导入了 ${added} 条` + (updated ? `，更新了 ${updated} 条同名条目` : '') + '。';
    draw();
  };
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => { const f = file.files[0]; file.value = ''; if (f) doImport(await f.text()); });
  add.addEventListener('click', () => { if (paste.value.trim()) { doImport(paste.value); if (!msg.classList.contains('bad')) paste.value = ''; } });
  exp.addEventListener('click', () => downloadText('references.bib', bibText(), 'application/x-bibtex'));
  q.addEventListener('input', draw);
  pop.replaceChildren(head, h('div', { class: 'tp-row' }, pick, file, exp), paste, h('div', { class: 'tp-row end' }, msg, h('span', { class: 'grow' }), add), q, list);
  applyRO(pop);
  draw();
}

/* ================= import reference articles → outline ================= */
const imp = { docs: [], ctl: null, result: null, timer: null };
const MAX_PDF = 10 * 1024 * 1024, MAX_TOTAL = 24 * 1024 * 1024;
const fmtSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function impMsg(t, bad) { const m = $('#impMsg'); m.textContent = t; m.classList.toggle('bad', !!bad); }
function readFileAs(file, how) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = () => rej(r.error);
    if (how === 'dataurl') r.readAsDataURL(file); else r.readAsText(file);
  });
}
async function addImportFiles(files) {
  for (const f of Array.from(files)) {
    if (imp.docs.length >= 3) { impMsg('最多三篇参考文章。', true); break; }
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const isText = /\.(txt|md|markdown|tex)$/i.test(f.name) || /^text\//.test(f.type);
    if (!isPdf && !isText) { impMsg(`${f.name} 的格式不支持，请上传 PDF、.tex、.txt 或 .md。`, true); continue; }
    if (isPdf && f.size > MAX_PDF) { impMsg(`${f.name} 超过 10 MB，请压缩，或只保留正文部分。`, true); continue; }
    if (imp.docs.reduce((a, d) => a + d.size, 0) + f.size > MAX_TOTAL) { impMsg('文件总大小超过 24 MB。', true); continue; }
    try {
      if (isPdf) {
        const url = String(await readFileAs(f, 'dataurl'));
        imp.docs.push({ name: f.name, kind: 'pdf', size: f.size, data: url.slice(url.indexOf(',') + 1) });
      } else {
        imp.docs.push({ name: f.name, kind: 'text', size: f.size, data: String(await readFileAs(f, 'text')) });
      }
      impMsg('');
    } catch { impMsg(`没能读取 ${f.name}。`, true); }
  }
  renderImpList();
}
function renderImpList() {
  const ul = $('#impList');
  ul.replaceChildren(...imp.docs.map((d, i) => {
    const x = h('button', { class: 'btn ghost icon-btn', type: 'button', title: '移除', 'aria-label': `移除 ${d.name}` }, '×');
    x.addEventListener('click', () => { imp.docs.splice(i, 1); renderImpList(); });
    return h('li', {}, h('span', { class: 'imp-kind' }, d.kind === 'pdf' ? 'PDF' : '文本'), h('span', { class: 'imp-name' }, d.name), h('span', { class: 'imp-size' }, fmtSize(d.size)), x);
  }));
  const left = 3 - imp.docs.length;
  $('#impPick').disabled = left <= 0;
  $('#impPick').textContent = imp.docs.length ? `再添加（还可 ${left} 篇）` : '选择文件';
  $('#impRun').disabled = !imp.docs.length || !!imp.ctl;
}
function openImport() {
  const b = $('#impBrief'); if (document.activeElement !== b) b.value = paper.brief;
  if (!aiUsable()) impMsg('润色与翻译暂不可用，暂时不能生成大纲。', true);
  renderImpList();
}
$('#btnImport').addEventListener('click', () => togglePanel('import'));
$('#impPick').addEventListener('click', () => $('#impFile').click());
$('#impFile').addEventListener('change', e => { addImportFiles(e.target.files); e.target.value = ''; });
$('#impDrop').addEventListener('dragover', e => { e.preventDefault(); $('#impDrop').classList.add('over'); });
$('#impDrop').addEventListener('dragleave', () => $('#impDrop').classList.remove('over'));
$('#impDrop').addEventListener('drop', e => { e.preventDefault(); $('#impDrop').classList.remove('over'); if (e.dataTransfer && e.dataTransfer.files.length) addImportFiles(e.dataTransfer.files); });
$('#impPasteToggle').addEventListener('click', () => {
  const box = $('#impPasteBox'); box.hidden = !box.hidden;
  $('#impPasteToggle').setAttribute('aria-expanded', String(!box.hidden));
  if (!box.hidden) $('#impPaste').focus();
});
$('#impPasteAdd').addEventListener('click', () => {
  const t = $('#impPaste').value.trim();
  if (t.length < 200) { impMsg('粘贴的内容太短，至少需要一篇文章的主要部分。', true); return; }
  if (imp.docs.length >= 3) { impMsg('最多三篇参考文章。', true); return; }
  imp.docs.push({ name: `粘贴的文章 ${imp.docs.length + 1}`, kind: 'text', size: new Blob([t]).size, data: t });
  $('#impPaste').value = ''; $('#impPasteBox').hidden = true; $('#impPasteToggle').setAttribute('aria-expanded', 'false');
  impMsg(''); renderImpList();
});
$('#impBrief').addEventListener('input', e => { paper.brief = e.target.value; touchMeta(); });
$('#impRun').addEventListener('click', runImport);
$('#impStop').addEventListener('click', () => imp.ctl && imp.ctl.abort());

function setImpBusy(busy) {
  $('#impStop').hidden = !busy;
  $('#impRun').textContent = busy ? '生成中…' : '分析并生成大纲';
  renderImpList();
}
async function runImport() {
  if (!imp.docs.length) { impMsg('请先添加至少一篇参考文章。', true); return; }
  if (imp.ctl) return;
  if (!(await aiReady())) { impMsg('润色与翻译暂不可用，暂时不能生成大纲。', true); return; }
  const ctl = new AbortController(); imp.ctl = ctl;
  setImpBusy(true); $('#impResult').hidden = true; imp.result = null;
  const t0 = Date.now(); let chars = 0;
  const tick = () => {
    const sec = Math.round((Date.now() - t0) / 1000);
    impMsg(chars ? `正在整理大纲…已写出 ${fmtNum(chars)} 字符（${sec} 秒）` : `正在阅读参考文章…${sec} 秒。文章较长时需要一两分钟，请不要关闭页面。`);
  };
  tick(); imp.timer = setInterval(tick, 1000);
  try {
    const payload = {
      paper: { title: paper.title, field: paper.field, brief: paper.brief },
      current: paper.order.map(id => sections[id]).filter(Boolean).map(s => ({ titleZh: s.titleZh, points: s.points.map(x => x.text).filter(t => t.trim()) })),
      docs: imp.docs.map(d => ({ name: d.name, kind: d.kind, data: d.data })),
    };
    const { text, truncated } = await streamAI('outline', payload, { signal: ctl.signal, onText: t => { chars = t.length; } });
    const result = parseOutline(text);
    if (!result) throw { code: truncated ? 'truncated' : 'bad_output' };
    imp.result = result;
    clearInterval(imp.timer);
    impMsg('');
    renderImpResult();
  } catch (e) {
    clearInterval(imp.timer);
    const code = e && e.code;
    if (code === 'cancelled') impMsg('已停止。');
    else if (code === 'unauthorized') impMsg('');
    else if (OFF_CODES[code]) { aiOff(OFF_CODES[code]); impMsg(OFF_CODES[code], true); }
    else impMsg(({
      too_long: '参考文章太长，超出了一次能读取的范围。请减少篇数，或只上传正文部分。',
      too_big: '文件太大，请压缩，或减少篇数后再试。',
      truncated: '大纲太长被截断了，请减少参考文章后重试。',
      bad_output: '没能读懂返回的大纲，请再试一次。',
    })[code] || errCopy(code), true);
  } finally {
    clearInterval(imp.timer); imp.ctl = null; setImpBusy(false);
  }
}
function parseOutline(text) {
  const t = str(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o; try { o = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  const secs = (Array.isArray(o.sections) ? o.sections : []).map(s => ({
    titleZh: str(s && s.titleZh).trim(), titleEn: str(s && s.titleEn).trim(), purpose: str(s && s.purpose).trim(),
    points: (Array.isArray(s && s.points) ? s.points : []).map(x => str(x).trim()).filter(Boolean).slice(0, 8),
  })).filter(s => s.titleZh || s.points.length).slice(0, 12);
  if (!secs.length) return null;
  return {
    analysis: (Array.isArray(o.analysis) ? o.analysis : []).map(x => ({ source: str(x && x.source).trim(), structure: str(x && x.structure).trim() })).filter(x => x.structure).slice(0, 3),
    common: str(o.common).trim(),
    sections: secs,
  };
}
function withSlots(text) {
  const out = []; let last = 0;
  text.replace(/【[^】]{1,40}】/g, (m, i) => { if (i > last) out.push(text.slice(last, i)); out.push(h('mark', {}, m)); last = i + m.length; return m; });
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function renderImpResult() {
  const r = imp.result; const box = $('#impResult');
  if (!r) { box.hidden = true; return; }
  const hasOld = paper.order.length > 0;
  const withParas = paper.order.filter(id => sections[id] && sections[id].paragraphs.length).length;
  const replace = hasOld
    ? confirmBtn('替换当前大纲', '确认替换？再点一次', () => applyOutline('replace'), 'btn primary')
    : h('button', { class: 'btn primary', type: 'button' }, '使用这份大纲');
  if (!hasOld) replace.addEventListener('click', () => applyOutline('replace'));
  const append = h('button', { class: 'btn', type: 'button' }, '追加到大纲末尾');
  append.addEventListener('click', () => applyOutline('append'));
  const again = h('button', { class: 'btn ghost', type: 'button' }, '重新生成');
  again.addEventListener('click', runImport);
  const applyBar = h('div', { class: 'imp-apply' }, replace, append, again,
    h('span', { class: 'help' }, hasOld
      ? (withParas ? `替换时，已经写了段落的 ${withParas} 个旧章节会保留在新大纲之后，段落不会丢失；可以用段落下方的「移到…」把它们移到新章节。` : '替换会清空当前大纲。')
      : '【】里是需要你补充的具体内容。'));
  box.replaceChildren(
    applyBar,
    r.analysis.length || r.common ? h('div', { class: 'imp-analysis' },
      h('h4', {}, '参考文章的论证逻辑'),
      r.analysis.length ? h('ol', {}, r.analysis.map(a => h('li', {}, a.source ? h('b', {}, a.source) : null, a.source ? '：' : '', a.structure))) : null,
      r.common ? h('p', { class: 'imp-common' }, h('b', {}, '可以借鉴的组织方式：'), r.common) : null) : null,
    h('div', { class: 'imp-outline' },
      h('h4', {}, `建议的大纲 · ${r.sections.length} 节`),
      h('ol', { class: 'imp-secs' }, r.sections.map((s, i) => h('li', {},
        h('div', { class: 'imp-sec-t' }, h('span', { class: 'imp-sec-n' }, '§' + (i + 1)), h('b', {}, s.titleZh || '未命名'), s.titleEn ? h('i', {}, s.titleEn) : null),
        s.purpose ? h('div', { class: 'imp-purpose' }, s.purpose) : null,
        h('ul', {}, s.points.map(pt => h('li', {}, withSlots(pt)))))))),
  );
  box.hidden = false;
  box.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
}
function applyOutline(mode) {
  const r = imp.result; if (!r || readOnly) return;
  const fresh = r.sections.map(s => newSection(s.titleZh || '未命名', s.titleEn, s.points.length ? s.points : [''], s.purpose));
  let kept = 0;
  if (mode === 'replace') {
    const keep = paper.order.filter(id => sections[id] && sections[id].paragraphs.length);
    paper.order.filter(id => !keep.includes(id)).forEach(id => { delete sections[id]; lsDel('pd:comp:' + id); touchSec(id); });
    kept = keep.length;
    const newTitles = new Set(fresh.map(s => s.titleZh.trim()));
    keep.forEach(id => { const o = sections[id]; if (newTitles.has(o.titleZh.trim())) { o.titleZh = o.titleZh.trim() + '（旧）'; touchSec(id); } });
    fresh.forEach(s => { sections[s.id] = s; touchSec(s.id); });
    paper.order = [...fresh.map(s => s.id), ...keep];
  } else {
    fresh.forEach(s => { sections[s.id] = s; touchSec(s.id); });
    paper.order.push(...fresh.map(s => s.id));
  }
  touchMeta();
  activeId = fresh[0].id; lsSet(activeKey(), activeId);
  imp.result = null; $('#impResult').hidden = true;
  togglePanel(null);
  renderOutline(); renderEditor();
  toast(mode === 'replace'
    ? `已换成新大纲，共 ${fresh.length} 节。` + (kept ? `有段落的 ${kept} 个旧章节保留在最后。` : '')
    : `已在大纲末尾追加 ${fresh.length} 节。`);
}

/* ================= export ================= */
const texTitle = s => s.replace(/(?<!\\)([%&#_])/g, '\\$1');
const zhComment = t => t.trim().split(/\n+/).map(l => '% ' + l.trim()).join('\n');
function slugBase(s) { return str(s).toLowerCase().replace(/\\[a-z]+/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
function secFile(sec, i) { return String(i + 1).padStart(2, '0') + '-' + (slugBase(sec.titleEn) || 'section'); }
function sectionTex(sec, i, opts) {
  const out = [`% ---- §${i + 1} ${sec.titleZh.trim()} ----`];
  const en = sec.titleEn.trim();
  out.push(en ? `\\section{${texTitle(en)}}\\label{sec:${slugBase(en) || 's' + (i + 1)}}` : `\\section{TODO}  % 英文标题待译：${sec.titleZh.trim()}`);
  out.push('');
  let k = 0;
  sec.paragraphs.forEach(p => {
    if (p.type === 'figure') { out.push(figureTex(p, opts), ''); return; }
    if (p.type === 'table') { out.push(tableTex(p, opts), ''); return; }
    k++;
    if (opts.zh && (p.polished || p.zh).trim()) out.push(zhComment(p.polished || p.zh));
    if (p.en.trim()) {
      if (p.polished && p.enFrom && p.polished !== p.enFrom) out.push(`% [¶${k}] 润色稿改动后尚未重译`);
      out.push(p.en.trim());
    } else {
      if (!opts.zh && p.zh.trim()) out.push(zhComment(p.zh));
      out.push(`% [¶${k}] 尚未翻译`);
    }
    out.push('');
  });
  return out.join('\n').trimEnd() + '\n';
}
function figFile(p) {
  const ext = p.asset.mime === 'application/pdf' ? 'pdf' : p.asset.mime === 'image/png' ? 'png' : 'jpg';
  return `${asciiSlug(p.asset.name) || 'figure'}-${p.asset.id.slice(0, 4).toLowerCase()}.${ext}`;
}
function captionTex(p, opts) {
  const lines = [];
  if (opts.zh && p.captionZh.trim()) lines.push(zhComment(p.captionZh).replace(/^/gm, '  '));
  if (p.captionEn.trim()) {
    if (p.captionFrom && p.captionFrom !== p.captionZh) lines.push('  % 中文注改动后尚未重译');
    lines.push(`  \\caption{${p.captionEn.trim()}}`);
  } else {
    if (!opts.zh && p.captionZh.trim()) lines.push(zhComment(p.captionZh).replace(/^/gm, '  '));
    lines.push('  \\caption{TODO}');
  }
  if (p.label.trim()) lines.push(`  \\label{${p.label.trim()}}`);
  return lines;
}
function figureTex(p, opts) {
  return [
    '\\begin{figure}[t]',
    '  \\centering',
    p.asset ? `  \\includegraphics[width=${p.width === 1 ? '' : p.width}\\linewidth]{figures/${figFile(p)}}` : '  % TODO：还没有选择图片文件',
    ...captionTex(p, opts),
    '\\end{figure}',
  ].join('\n');
}
function tableTex(p, opts) {
  if (p.mode === 'latex' && /\\begin\{table\*?\}/.test(p.latex)) return p.latex.trim();
  const body = p.mode === 'latex' ? p.latex.trim().split('\n').map(l => '  ' + l).join('\n') : gridTabular(p.grid, '  ');
  return ['\\begin{table}[t]', '  \\centering', ...captionTex(p, opts), body, '\\end{table}'].join('\n');
}
function mainTex(body) {
  const t = paper.titleEn.trim();
  return [
    `% 由「论文译写台」导出 · ${fmtDate(Date.now())}`,
    paper.title.trim() ? `% 中文题目：${paper.title.trim()}` : null,
    '\\documentclass[11pt]{article}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{booktabs}',
    bib.entries.length ? '\\usepackage[numbers]{natbib}' : null,
    '\\usepackage[hidelinks]{hyperref}',
    '',
    t ? `\\title{${texTitle(t)}}` : '\\title{TODO}  % 在「设置与术语」里填写英文题目',
    '\\author{}',
    '\\date{}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    body.trimEnd(),
    '',
    bib.entries.length ? '\\bibliographystyle{plainnat}' : '% \\bibliographystyle{plainnat}',
    bib.entries.length ? '\\bibliography{references}' : '% \\bibliography{references}',
    '\\end{document}',
    '',
  ].filter(x => x != null).join('\n');
}
function currentTex() {
  const opts = { zh: paper.zhComments };
  if (exportScope === 'sec') { const s = activeSec(); return s ? sectionTex(s, secIndex(s.id), opts) : '% 还没有章节\n'; }
  return mainTex(paper.order.map((id, i) => sectionTex(sections[id], i, opts)).join('\n'));
}
function refreshExport() {
  $('#scopeSec').setAttribute('aria-pressed', String(exportScope === 'sec'));
  $('#scopeAll').setAttribute('aria-pressed', String(exportScope === 'all'));
  $('#zhComments').checked = paper.zhComments;
  const s = activeSec();
  $('#texLabel').textContent = exportScope === 'sec' ? (s ? `sections/${secFile(s, secIndex(s.id))}.tex` : '—') : 'main.tex（单文件，全文）';
  $('#texPreview').value = currentTex();
  $('#btnCopyTex').textContent = exportScope === 'sec' ? '复制本节 LaTeX' : '复制全文 LaTeX';
}
function selectPreview() { const t = $('#texPreview'); t.focus(); t.select(); }
function expMsg(t, bad) { const m = $('#expMsg'); m.textContent = t; m.classList.toggle('bad', !!bad); }
$('#scopeSec').addEventListener('click', () => { exportScope = 'sec'; refreshExport(); expMsg(''); });
$('#scopeAll').addEventListener('click', () => { exportScope = 'all'; refreshExport(); expMsg(''); });
$('#zhComments').addEventListener('change', e => { if (!readOnly) { paper.zhComments = e.target.checked; touchMeta(); } refreshExport(); });
$('#btnCopyTex').addEventListener('click', async () => {
  refreshExport();
  const ok = await copyText($('#texPreview').value);
  if (ok) expMsg(exportScope === 'sec' ? '已复制。粘贴到 Overleaf 中本节对应的 .tex 文件即可。' : '已复制全文。可以粘贴为 Overleaf 项目的 main.tex。');
  else { selectPreview(); expMsg('浏览器不允许直接复制，右侧文字已全选，请按 ⌘/Ctrl + C。', true); }
});
$('#btnZip').addEventListener('click', async () => {
  if (!window.JSZip) { expMsg('打包组件没有加载成功，请刷新页面，或改用“复制 LaTeX”。', true); return; }
  if (!paper.order.length) { expMsg('还没有章节可以导出。', true); return; }
  const b = $('#btnZip'); b.disabled = true;
  try {
    const zip = new JSZip(); const opts = { zh: paper.zhComments };
    const inputs = paper.order.map((id, i) => { const s = sections[id]; const f = secFile(s, i); zip.file(`sections/${f}.tex`, sectionTex(s, i, opts)); return `\\input{sections/${f}}`; });
    zip.file('main.tex', mainTex(inputs.join('\n')));
    if (bib.entries.length) zip.file('references.bib', bibText());
    const figs = paper.order.flatMap(id => (sections[id] ? sections[id].paragraphs : []).filter(p => p.type === 'figure' && p.asset));
    let missing = 0;
    for (const p of figs) {
      try { const url = await assetBlobUrl(p.asset); zip.file('figures/' + figFile(p), await (await fetch(url)).blob()); }
      catch { missing++; }
    }
    if (missing) expMsg(`有 ${missing} 张图没能下载，压缩包里缺少这些文件。`, true);
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: (slugBase(paper.titleEn) || 'paper') + '-overleaf.zip' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (!missing) expMsg('已下载。在 Overleaf 选 New Project → Upload Project，上传这个 .zip。' + (figs.length ? `里面有 ${figs.length} 张图` : '') + (bib.entries.length ? `${figs.length ? '和' : '里面有'} references.bib。` : (figs.length ? '。' : '')));
  } catch {
    expMsg('打包没有完成，请改用“复制 LaTeX”。', true);
  } finally { b.disabled = false; }
});

/* ================= boot ================= */
function renderAll() { renderHeader(); renderOutline(); renderEditor(); updateSaveState(); renderBanner(); if (!$('#panelSettings').hidden) renderSettings(); if (!$('#panelExport').hidden) refreshExport(); }

async function loadPaper() {
  showView('desk');
  renderAll();
  let data;
  try { data = await api('GET', '/api/papers/' + paperId); }
  catch (e) {
    if (e.code === 'unauthorized') return;
    if (e.code === 'not_found') { forgetPaper(paperId); history.replaceState(null, '', '/'); renderHome('没有找到这篇论文，可能已被删除，或链接不完整。'); return; }
    notice('load', '连不上服务器，没能打开这篇论文。请检查网络后刷新页面。');
    return;
  }
  paper = normPaper(data.meta && data.meta.body);
  if (data.meta) { revs.set('meta', data.meta.rev); lastJSON.set('meta', JSON.stringify(metaBody())); }
  const be = data.bib && data.bib.body && Array.isArray(data.bib.body.entries) ? data.bib.body.entries : [];
  bib = { entries: be.map(hydrateEntry).filter(e => e.key) };
  rebuildBibIndex();
  if (data.bib) { revs.set('bib', data.bib.rev); lastJSON.set('bib', JSON.stringify(bibBody())); }
  sections = {};
  for (const s of data.sections || []) {
    sections[s.id] = normSec(s.id, s.body);
    revs.set('s:' + s.id, s.rev);
    lastJSON.set('s:' + s.id, JSON.stringify(secBody(s.id)));
  }
  paper.order = paper.order.filter(id => sections[id]);
  Object.keys(sections).forEach(id => { if (!paper.order.includes(id)) paper.order.push(id); });
  const saved = lsGet(activeKey(), null);
  activeId = sections[saved] ? saved : (paper.order[0] || null);
  loaded = true;
  rememberPaper(paperId, paper.title, paper.titleEn);
  renderAll();
}

async function boot() {
  let cfg;
  try { cfg = await fetchConfig(); }
  catch { showView('home'); $('#homeMsg').textContent = '连不上服务器，请稍后刷新页面。'; return; }
  if (cfg.needCode && !cfg.codeOk) cfg = await showGate(accessCode ? '访问码已失效，请重新输入。' : '');
  ai.state = cfg.ai ? 'ok' : 'off';
  if (!cfg.ai) notice('ai', OFF_CODES.no_key);
  else if (cfg.demo) notice('ai', '演示模式：服务器没有调用 Claude，润色和翻译结果是模拟的。');
  aiResolve();
  if (paperId) loadPaper();
  else renderHome();
}

let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => autosizeAll(document), 150); });
boot();
})();
