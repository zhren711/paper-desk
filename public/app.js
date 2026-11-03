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
  const sc = $('#editor'); const top = sc ? sc.scrollTop : 0; const wy = window.scrollY;
  t.style.height = 'auto';
  t.style.height = (t.scrollHeight + 2) + 'px';
  if (sc) sc.scrollTop = top;
  if (window.scrollY !== wy) window.scrollTo(0, wy);
}
function autosizeAll(root) { requestAnimationFrame(() => $$('textarea.ta, textarea.pt-ta', root).forEach(autosize)); }

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

function blankPaper() { return { title: '', titleEn: '', field: '', strength: 'medium', spelling: 'US', glossary: [], order: [], zhComments: true }; }
function normPaper(m) {
  const o = Object.assign(blankPaper(), m || {});
  o.title = str(o.title); o.titleEn = str(o.titleEn); o.field = str(o.field);
  o.glossary = Array.isArray(o.glossary) ? o.glossary.map(g => ({ zh: str(g && g.zh), en: str(g && g.en) })) : [];
  o.order = Array.isArray(o.order) ? o.order.map(String) : [];
  if (!STRENGTH[o.strength]) o.strength = 'medium';
  if (o.spelling !== 'UK') o.spelling = 'US';
  o.zhComments = o.zhComments !== false;
  return o;
}
function normPara(p) {
  p = p || {};
  return { id: str(p.id) || uid(), zh: str(p.zh), polished: str(p.polished), notes: Array.isArray(p.notes) ? p.notes.map(String).slice(0, 6) : [], en: str(p.en), point: str(p.point), polishedFrom: str(p.polishedFrom), enFrom: str(p.enFrom) };
}
function normSec(id, s) {
  s = s || {};
  return {
    id, titleZh: str(s.titleZh), titleEn: str(s.titleEn),
    points: Array.isArray(s.points) ? s.points.map(x => ({ id: str(x && x.id) || uid(), text: str(x && x.text) })) : [],
    paragraphs: Array.isArray(s.paragraphs) ? s.paragraphs.map(normPara) : [],
  };
}
function newSection(titleZh = '新章节', titleEn = '', points = ['']) {
  return { id: 's' + uid(), titleZh, titleEn, points: points.map(t => ({ id: uid(), text: t })), paragraphs: [] };
}

let paper = blankPaper();
let sections = {};
let activeId = null;
let readOnly = false;
let showDiff = lsGet('pd:diff', true);
let collapsed = lsGet('pd:collapsed', false);
let exportScope = 'sec';
const rtMap = new Map();
const R = id => { if (!rtMap.has(id)) rtMap.set(id, {}); return rtMap.get(id); };
const activeSec = () => sections[activeId] || null;
const secIndex = id => paper.order.indexOf(id);
const activeKey = () => 'pd:active:' + paperId;

function paraState(p) {
  const r = R(p.id);
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
  const n = sec.paragraphs.length;
  const done = sec.paragraphs.filter(p => paraState(p)[0] === 'done').length;
  const words = sec.paragraphs.reduce((a, p) => a + wordCount(p.en), 0);
  return { n, done, words };
}

/* ================= persistence (REST, optimistic revisions) ================= */
let loaded = false;
const lastJSON = new Map(), revs = new Map(), timers = new Map(), inflight = new Map(), again = new Set();
let saveErr = null, retryTimer = null;

function metaBody() {
  const { title, titleEn, field, strength, spelling, glossary, order, zhComments } = paper;
  return { title, titleEn, field, strength, spelling, glossary, order, zhComments };
}
function secBody(id) {
  const s = sections[id]; if (!s) return null;
  return { titleZh: s.titleZh, titleEn: s.titleEn, points: s.points, paragraphs: s.paragraphs.map(p => ({ id: p.id, zh: p.zh, polished: p.polished, notes: p.notes, en: p.en, point: p.point, polishedFrom: p.polishedFrom, enFrom: p.enFrom })) };
}
function touch(key) {
  if (readOnly || !loaded) return;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => flush(key), 800));
  updateSaveState();
}
const touchMeta = () => touch('meta');
const touchSec = id => touch('s:' + id);

async function flush(key, opts = {}) {
  clearTimeout(timers.get(key)); timers.delete(key);
  if (readOnly) return;
  if (inflight.has(key)) { again.add(key); return; }
  const job = (async () => {
    const sid = key === 'meta' ? null : key.slice(2);
    const body = key === 'meta' ? metaBody() : secBody(sid);
    const json = body === null ? null : JSON.stringify(body);
    if (lastJSON.has(key) && lastJSON.get(key) === json) return;
    if (json === null) {
      await api('DELETE', `/api/papers/${paperId}/sections/${encodeURIComponent(sid)}`, undefined, opts);
      revs.delete(key);
    } else {
      const url = key === 'meta' ? `/api/papers/${paperId}/meta` : `/api/papers/${paperId}/sections/${encodeURIComponent(sid)}`;
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
    paper: { title: paper.title, titleEn: paper.titleEn, field: paper.field, strength: paper.strength, spelling: paper.spelling, glossary: glossary() },
    section: { index: secIndex(sec.id), titleZh: sec.titleZh, titleEn: sec.titleEn, points: sec.points.map(x => x.text) },
  };
}
function polishPayload(sec, p) {
  const i = sec.paragraphs.indexOf(p);
  const prev = i > 0 ? sec.paragraphs[i - 1] : null;
  return { ...ctxPayload(sec), linked: p.point ? sec.points.findIndex(x => x.id === p.point) : -1, prev: prev ? (prev.polished || prev.zh) : '', text: p.zh };
}
function translatePayload(sec, p) {
  const i = sec.paragraphs.indexOf(p);
  const prev = i > 0 ? sec.paragraphs[i - 1] : null;
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
  const map = { settings: ['#btnSettings', '#panelSettings'], export: ['#btnExport', '#panelExport'] };
  for (const [k, [b, p]] of Object.entries(map)) {
    const open = k === which ? $(p).hidden : false;
    $(p).hidden = !open; $(b).setAttribute('aria-expanded', String(open));
  }
  if (!$('#panelExport').hidden) refreshExport();
  if (!$('#panelSettings').hidden) renderSettings();
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
  });
  const left = h('button', { type: 'button', title: '前移', 'aria-label': '前移本节', 'data-edit': '', disabled: i === 0 }, '←');
  const right = h('button', { type: 'button', title: '后移', 'aria-label': '后移本节', 'data-edit': '', disabled: i === paper.order.length - 1 }, '→');
  left.addEventListener('click', e => { e.stopPropagation(); moveSection(sec.id, -1); });
  right.addEventListener('click', e => { e.stopPropagation(); moveSection(sec.id, 1); });
  const num = h('button', { class: 'ocard-num', type: 'button', title: '打开本节' }, '§' + (i + 1));
  num.addEventListener('click', () => setActive(sec.id));

  const pts = h('ol', { class: 'points' }, sec.points.map((pt, k) => pointItem(sec, pt, k)));
  const addPt = h('button', { class: 'add-point', type: 'button', 'data-edit': '' }, '+ 论点');
  addPt.addEventListener('click', e => {
    e.stopPropagation();
    sec.points.push({ id: uid(), text: '' }); touchSec(sec.id);
    renderCard(sec.id, c => { const t = $$('.pt-ta', c).pop(); if (t) t.focus(); });
    if (activeId === sec.id) refreshPointOptions(sec);
  });
  const st = secStats(sec);
  const card = h('article', { class: 'ocard' + (sec.id === activeId ? ' is-active' : ''), 'data-id': sec.id },
    h('header', { class: 'ocard-head' }, num, title, h('div', { class: 'ocard-move' }, left, right)),
    h('div', { class: 'ocard-en' + (sec.titleEn.trim() ? '' : ' missing') }, sec.titleEn.trim() || '英文标题待译'),
    pts, addPt,
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
  ta.addEventListener('input', () => { pt.text = ta.value; touchSec(sec.id); autosize(ta); if (activeId === sec.id) refreshPointOptions(sec); });
  ta.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sec.points.splice(k + 1, 0, { id: uid(), text: '' }); touchSec(sec.id);
      renderCard(sec.id, c => { const t = $$('.pt-ta', c)[k + 1]; if (t) t.focus(); });
      if (activeId === sec.id) refreshPointOptions(sec);
    } else if (e.key === 'Backspace' && ta.value === '') { e.preventDefault(); removePoint(sec, k, true); }
  });
  const x = h('button', { class: 'pt-x', type: 'button', title: '删除观点', 'aria-label': `删除观点 p${k + 1}`, 'data-edit': '' }, '×');
  x.addEventListener('click', e => { e.stopPropagation(); removePoint(sec, k, false); });
  return h('li', { class: 'point' + (covered ? ' is-covered' : ''), 'data-pid': pt.id }, h('span', { class: 'pmark', 'aria-hidden': 'true', title: covered ? '已有段落论证' : '尚无段落' }), ta, x);
}
function removePoint(sec, k, focusPrev) {
  const [pt] = sec.points.splice(k, 1); if (!pt) return;
  sec.paragraphs.forEach(p => { if (p.point === pt.id) p.point = ''; });
  touchSec(sec.id);
  renderCard(sec.id, c => {
    if (!focusPrev) return;
    const t = $$('.pt-ta', c)[Math.max(0, k - 1)];
    if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  });
  if (activeId === sec.id) { refreshPointOptions(sec); sec.paragraphs.forEach(p => refreshPara(sec, p)); }
}
function renderCard(id, after) {
  const old = $(`.ocard[data-id="${id}"]`); const sec = sections[id]; if (!old || !sec) return;
  const fresh = outlineCard(sec, secIndex(id));
  old.replaceWith(fresh); applyRO(fresh); autosizeAll(fresh);
  if (after) requestAnimationFrame(() => after(fresh));
}
function updateCardStats(id) {
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
  if (!loaded) { inner.append(h('p', { class: 'loading' }, '正在打开你的论文…')); ed.replaceChildren(inner); return; }
  const sec = activeSec();
  if (!sec) { inner.append(welcome()); ed.replaceChildren(inner); applyRO(inner); return; }
  const paras = h('div', { class: 'paras', id: 'paras' }, sec.paragraphs.map(p => paraRow(sec, p)));
  inner.append(secHead(sec), colsHead(), paras);
  if (!sec.paragraphs.length) inner.append(h('p', { class: 'sec-empty', id: 'secEmpty' }, '本节还没有段落。对照上方大纲里的观点，一段一段写下中文。'));
  if (!readOnly) inner.append(composer(sec));
  ed.replaceChildren(inner);
  ed.scrollTop = 0;
  applyRO(inner);
  autosizeAll(inner);
}

function welcome() {
  const b1 = h('button', { class: 'btn primary', type: 'button' }, '套用常见结构');
  const b2 = h('button', { class: 'btn', type: 'button' }, '添加空白章节');
  b1.addEventListener('click', applyTemplate); b2.addEventListener('click', addSection);
  return h('div', { class: 'welcome' },
    h('h1', {}, '从思路开始写'),
    h('p', {}, '先在上方大纲列出章节，并为每一节写下要论证的观点。然后在这里一段一段用中文写；每段完成后，会先润色中文逻辑，再译成可以直接放进 LaTeX 的英文。'),
    readOnly ? null : h('div', { class: 'btns' }, b1, b2),
    h('p', { class: 'small' }, '常见结构：引言 · 相关工作 · 方法 · 实验 · 结论'));
}

function secHead(sec) {
  const i = secIndex(sec.id);
  const zh = h('input', { class: 'sec-zh', id: 'secZh-' + sec.id, 'data-edit': '', value: sec.titleZh, placeholder: '章节标题', 'aria-label': '章节中文标题' });
  zh.addEventListener('input', () => {
    sec.titleZh = zh.value; touchSec(sec.id);
    const c = document.getElementById('ct-' + sec.id); if (c && document.activeElement !== c) c.value = zh.value;
  });
  const en = h('input', { class: 'sec-en', id: 'secEn-' + sec.id, 'data-edit': '', value: sec.titleEn, placeholder: 'English section title', 'aria-label': '章节英文标题' });
  en.addEventListener('input', () => { sec.titleEn = en.value; touchSec(sec.id); updateCardStats(sec.id); });
  const tBtn = h('button', { class: 'btn tiny ghost', id: 'secEnBtn-' + sec.id, type: 'button', 'data-edit': '' }, '译标题');
  tBtn.addEventListener('click', () => translateSectionTitle(sec));
  if (!aiUsable()) tBtn.hidden = true;
  if (R('t:' + sec.id).busy) { tBtn.disabled = true; tBtn.textContent = '翻译中…'; }

  const diff = h('input', { type: 'checkbox', id: 'diffToggle' }); diff.checked = showDiff;
  diff.addEventListener('change', () => { showDiff = diff.checked; lsSet('pd:diff', showDiff); sec.paragraphs.forEach(p => { R(p.id).editPolish = false; refreshPara(sec, p); }); });
  const copy = h('button', { class: 'btn tiny', type: 'button' }, '复制本节 LaTeX');
  copy.addEventListener('click', async () => {
    const ok = await copyText(sectionTex(sec, i, { zh: paper.zhComments }));
    copy.textContent = ok ? '已复制' : '请在导出面板中复制';
    if (!ok) { exportScope = 'sec'; if ($('#panelExport').hidden) togglePanel('export'); else refreshExport(); selectPreview(); }
    setTimeout(() => (copy.textContent = '复制本节 LaTeX'), 1800);
  });
  const del = confirmBtn('删除本节', '确认删除本节？', () => deleteSection(sec.id));
  return h('div', { class: 'sec-head' },
    h('div', { class: 'sec-num', 'aria-hidden': 'true' }, '§' + (i + 1)),
    h('div', { class: 'sec-titles' }, zh, h('div', { class: 'sec-en-row' }, en, tBtn)),
    h('div', { class: 'sec-tools' }, h('label', { class: 'toggle', for: 'diffToggle' }, diff, '显示润色改动'), copy, readOnly ? null : del));
}
function colsHead() {
  const s = (b, i) => h('span', {}, h('b', {}, b), h('i', {}, i));
  return h('div', { class: 'cols-head', 'aria-hidden': 'true' }, h('span'), s('草稿', '你写的中文'), s('润色', '理顺逻辑后的中文'), s('English', '可直接放进 LaTeX'));
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
  const n = sec.paragraphs.indexOf(p) + 1;
  const draft = makeTA('ta zh', 'zh-' + p.id, p.zh, v => { p.zh = v; R(p.id).err = ''; touchSec(sec.id); refreshStatus(sec, p); }, '中文草稿');
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
  const [st, label] = paraState(p);
  const pill = $('.pill', row); pill.className = 'pill st-' + st; pill.textContent = label;
  renderActions(sec, p, row);
  $('.p-msg', row).textContent = R(p.id).err || '';
}
function refreshPara(sec, p, row) {
  row = row || document.getElementById('para-' + p.id); if (!row) return;
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
  else mode = 'edit';
  const prev = box.dataset.mode; box.dataset.mode = mode;
  const meta = $('.en-meta', row);
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
function mountEnTA(sec, p, row, box) {
  const ta = makeTA('ta en', 'en-' + p.id, p.en, v => { p.en = v; touchSec(sec.id); renderEnMeta(p, $('.en-meta', row)); updateCardStats(sec.id); updatePaperStats(); }, '英文译文');
  if (readOnly) ta.readOnly = true;
  box.replaceChildren(ta);
  requestAnimationFrame(() => autosize(ta));
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
  if (aiUsable()) {
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
  box.append(up, down, confirmBtn('删除', '确认删除', () => deletePara(sec, p), 'btn tiny ghost danger'));
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
  sec.paragraphs.forEach((p, i) => { const row = document.getElementById('para-' + p.id); if (row) { $('.p-num', row).textContent = '¶' + (i + 1); renderActions(sec, p, row); } });
  const c = $('#compNum'); if (c) c.textContent = '¶' + (sec.paragraphs.length + 1);
}
function movePara(sec, p, d) {
  const i = sec.paragraphs.indexOf(p), j = i + d;
  if (i < 0 || j < 0 || j >= sec.paragraphs.length) return;
  [sec.paragraphs[i], sec.paragraphs[j]] = [sec.paragraphs[j], sec.paragraphs[i]];
  touchSec(sec.id);
  const box = $('#paras'); sec.paragraphs.forEach(x => { const r = document.getElementById('para-' + x.id); if (r) box.append(r); });
  renumber(sec);
  const row = document.getElementById('para-' + p.id);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
}
function deletePara(sec, p) {
  const r = R(p.id); if (r.ctl) r.ctl.abort();
  const i = sec.paragraphs.indexOf(p); if (i < 0) return;
  sec.paragraphs.splice(i, 1); touchSec(sec.id);
  const row = document.getElementById('para-' + p.id); if (row) row.remove();
  renumber(sec); updateCardStats(sec.id); updatePaperStats();
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
  sec.paragraphs.forEach((p, k) => {
    if (opts.zh && (p.polished || p.zh).trim()) out.push(zhComment(p.polished || p.zh));
    if (p.en.trim()) {
      if (p.polished && p.enFrom && p.polished !== p.enFrom) out.push(`% [¶${k + 1}] 润色稿改动后尚未重译`);
      out.push(p.en.trim());
    } else {
      if (!opts.zh && p.zh.trim()) out.push(zhComment(p.zh));
      out.push(`% [¶${k + 1}] 尚未翻译`);
    }
    out.push('');
  });
  return out.join('\n').trimEnd() + '\n';
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
    '% \\bibliographystyle{plain}',
    '% \\bibliography{references}',
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
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: (slugBase(paper.titleEn) || 'paper') + '-overleaf.zip' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    expMsg('已下载。在 Overleaf 选 New Project → Upload Project，上传这个 .zip。');
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
