// 提示词全部在服务器端拼装：浏览器只能提交论文内容，不能让网站代为执行任意指令。
const STRENGTH = {
  light: '轻度——只修正病句、衔接词和指代不清，尽量保留作者原句与语序。',
  medium: '中度——理顺句与句之间的逻辑，补足必要的衔接，删去重复与口语化表达，可适度调整语序。',
  heavy: '深度——可以重组句子顺序，使段落形成“主题句—论据—小结”的清晰结构，但不得增删观点。',
};

const S = (v, max) => {
  const s = typeof v === 'string' ? v : '';
  return s.length > max ? s.slice(0, max) : s;
};
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

function readContext(b) {
  const p = b.paper && typeof b.paper === 'object' ? b.paper : {};
  const sec = b.section && typeof b.section === 'object' ? b.section : {};
  return {
    paper: {
      title: S(p.title, 300).trim(),
      titleEn: S(p.titleEn, 300).trim(),
      field: S(p.field, 120).trim(),
      strength: STRENGTH[p.strength] ? p.strength : 'medium',
      spelling: p.spelling === 'UK' ? 'UK' : 'US',
      brief: S(p.brief, 1500).trim(),
      glossary: (Array.isArray(p.glossary) ? p.glossary : []).slice(0, 200)
        .map(g => ({ zh: S(g && g.zh, 80).trim(), en: S(g && g.en, 160).trim() }))
        .filter(g => g.zh && g.en),
    },
    section: {
      index: Number.isInteger(sec.index) && sec.index >= 0 ? sec.index : 0,
      titleZh: S(sec.titleZh, 200).trim(),
      titleEn: S(sec.titleEn, 200).trim(),
      note: S(sec.note, 300).trim(),
      points: (Array.isArray(sec.points) ? sec.points : []).slice(0, 40).map(t => S(t, 300).trim()),
    },
    linked: Number.isInteger(b.linked) ? b.linked : -1,
    prev: S(b.prev, 2000).trim(),
    text: S(b.text, 12000).trim(),
  };
}

function polish(c) {
  const { paper, section } = c;
  const ptLines = section.points.map((t, k) => (t ? `p${k + 1}：${t}` : null)).filter(Boolean);
  const prompt = [
    `论文题目：${paper.title || '（未填写）'}`,
    `学科领域：${paper.field || '（未填写）'}`,
    paper.brief ? `作者的研究内容：${clip(paper.brief, 600)}` : null,
    `当前章节：第 ${section.index + 1} 节「${section.titleZh || '未命名'}」`,
    section.note ? `本节作用：${section.note}` : null,
    ptLines.length ? '本节大纲中要论证的观点：\n' + ptLines.join('\n') : '本节大纲暂未列出观点。',
    c.linked >= 0 && section.points[c.linked] ? `作者标注这一段对应观点 p${c.linked + 1}。` : null,
    c.prev ? `上一段（只用于衔接参考，不要改写它）：\n${clip(c.prev, 800)}` : null,
    paper.glossary.length ? '术语表（这些术语保持原样）：' + paper.glossary.map(g => g.zh).join('、') : null,
    '',
    `润色力度：${STRENGTH[paper.strength]}`,
    '',
    '要求：',
    '1. 不改变作者的观点和事实，不编造数据、文献或实验结果；原文没有的信息不要补充。',
    '2. 原样保留 LaTeX 命令、公式和引用，例如 \\cite{...}、$...$、\\ref{...}。',
    '3. 重点检查：主题句是否明确；句与句之间的因果、递进、转折是否成立；指代是否清楚；有无重复或跳跃。',
    '4. 使用规范的学术书面语，避免口语化表达。',
    '5. 批注：用 1 到 4 条简短的中文说明你修正了哪些逻辑问题；如果这一段偏离本节观点或论据不足，也要指出。每条不超过 40 字。',
    '',
    '待润色段落：',
    '<<<',
    c.text,
    '>>>',
    '',
    '严格按以下格式回复，不要添加其他内容：',
    '【润色】',
    '（润色后的段落）',
    '【批注】',
    '- （第一条说明）',
    '- （第二条说明）',
    '【论点】（这一段主要服务的观点编号，例如 p1；无法对应时写“无”）',
  ].filter(x => x != null).join('\n');
  return {
    system: '你是一位严谨的学术写作导师，帮助作者润色中文论文段落。你的重点是理顺逻辑，而不是堆砌辞藻。',
    prompt,
    maxTokens: 3000,
  };
}

function translate(c) {
  const { paper, section } = c;
  const prompt = [
    `Translate the Chinese paragraph below into English for a research paper${paper.field ? ` in the field of ${paper.field}` : ''}.`,
    '',
    `Paper title: ${paper.titleEn || paper.title || '(not given)'}`,
    `Section: ${section.titleEn || section.titleZh || '(untitled)'}`,
    `Spelling: ${paper.spelling === 'UK' ? 'British English' : 'American English'}.`,
    paper.glossary.length ? 'Glossary (use exactly these English terms):\n' + paper.glossary.map(g => `${g.zh} → ${g.en}`).join('\n') : null,
    c.prev ? `Previous paragraph in English, for continuity only (do not repeat or translate it):\n${clip(c.prev, 1200)}` : null,
    '',
    'Rules:',
    '- Stay faithful to the Chinese. Do not add claims, numbers, citations or hedges that are not there.',
    '- Write clear, concise academic English with precise verbs and natural transitions. No filler.',
    "- The output goes straight into a LaTeX file: keep LaTeX commands, math and citations exactly as written (\\cite{...}, $...$, \\ref{...}); escape %, &, # and _ outside math as \\%, \\&, \\#, \\_; write quotation marks as `` and ''.",
    '- Reply with the English paragraph only: no heading, no notes, no Markdown, no code fences.',
    '',
    'Chinese paragraph:',
    '<<<',
    c.text,
    '>>>',
  ].filter(x => x != null).join('\n');
  return {
    system: 'You are an expert translator of Chinese academic writing into publication-quality English.',
    prompt,
    maxTokens: 3000,
  };
}

function title(c) {
  const { paper } = c;
  const prompt = [
    'Translate this Chinese heading of a research paper into a concise English heading in Title Case.',
    paper.field ? `Field: ${paper.field}.` : null,
    paper.glossary.length ? 'Glossary: ' + paper.glossary.map(g => `${g.zh} → ${g.en}`).join('; ') : null,
    `Heading: ${clip(c.text, 300)}`,
    'Reply with the English heading only.',
  ].filter(Boolean).join('\n');
  return { system: 'You translate academic paper headings from Chinese to English.', prompt, maxTokens: 120, fast: true };
}

// 从 1 到 3 篇参考文章提炼论证结构，并按同样的组织方式为作者的论文拟大纲。
const MAX_DOC_CHARS = 250_000;
const MAX_TOTAL_B64 = 40_000_000;
function bad(status, message) { const e = new Error(message); e.status = status; return e; }

function outline(b) {
  const p = b.paper && typeof b.paper === 'object' ? b.paper : {};
  const docs = Array.isArray(b.docs) ? b.docs : [];
  if (!docs.length) throw bad(400, '请至少提供一篇参考文章');
  if (docs.length > 3) throw bad(400, '最多三篇参考文章');
  const content = [];
  let total = 0;
  docs.forEach((d, i) => {
    const name = S(d && d.name, 200).trim() || `参考文章 ${i + 1}`;
    if (d && d.kind === 'pdf') {
      const data = typeof d.data === 'string' ? d.data.replace(/\s+/g, '') : '';
      if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data.slice(0, 4000)) || !data.startsWith('JVBER')) throw bad(400, `${name} 不是有效的 PDF`);
      total += data.length;
      content.push({ type: 'text', text: `参考文章 ${i + 1}（文件名：${name}）：` });
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    } else {
      const text = S(d && d.data, MAX_DOC_CHARS).trim();
      if (!text) throw bad(400, `${name} 没有内容`);
      total += text.length;
      content.push({ type: 'text', text: `参考文章 ${i + 1}（${name}）：\n<<<\n${text}\n>>>` });
    }
  });
  if (total > MAX_TOTAL_B64) throw bad(413, '参考文章太大');

  const title = S(p.title, 300).trim();
  const field = S(p.field, 120).trim();
  const brief = S(p.brief, 3000).trim();
  const current = (Array.isArray(b.current) ? b.current : []).slice(0, 20).map(s => ({
    titleZh: S(s && s.titleZh, 100).trim(),
    points: (Array.isArray(s && s.points) ? s.points : []).slice(0, 10).map(t => S(t, 200).trim()).filter(Boolean),
  })).filter(s => s.titleZh || s.points.length);
  const n = docs.length;

  content.push({ type: 'text', text: [
    `上面是 ${n} 篇参考文章。作者希望自己的论文借鉴它们的组织逻辑。`,
    '',
    '作者的论文：',
    `- 题目：${title || '（未填写）'}`,
    `- 学科领域：${field || '（未填写）'}`,
    `- 研究内容：${brief || '（作者没有填写。请根据题目推断，并把需要作者补充的具体内容用【】标出）'}`,
    current.length ? '- 作者目前的初步大纲（可以吸收其中有用的想法）：\n' + current.map(s => `  · ${s.titleZh}${s.points.length ? '：' + s.points.join('；') : ''}`).join('\n') : null,
    '',
    '请完成两件事：',
    `1. 分析${n > 1 ? '每篇' : '这篇'}参考文章的论证结构：分成哪几部分，每部分承担什么作用，部分之间怎样衔接。${n > 1 ? '再找出它们共同的、值得借鉴的组织方式。' : ''}`,
    '2. 按照这种组织方式，为作者的论文拟一份大纲：',
    '   - 章节的数量和顺序参照参考文章，通常 4 到 8 节；与作者研究无关的章节不要照搬',
    '   - 每节给出中文标题、英文标题（采用学术论文的常见写法）和一句话说明本节作用',
    '   - 每节列出 2 到 6 个要论证的观点，按论证顺序排列；每个观点是一句完整的中文，不超过 40 字，尽量具体到作者的研究',
    '   - 作者需要补充的具体信息用【】标出，例如【数据集名称】；不要编造作者的实验结果、数据或文献',
    '',
    '只回复一个 JSON 对象，不要有任何其他文字：',
    '{"analysis":[{"source":"参考文章 1 的题目","structure":"用 1 到 2 句话概括它的论证结构"}],"common":"一句话概括可借鉴的组织逻辑","sections":[{"titleZh":"引言","titleEn":"Introduction","purpose":"本节作用","points":["观点 1","观点 2"]}]}',
  ].filter(x => x != null).join('\n') });

  return {
    system: '你是一位资深的学术写作导师，擅长分析论文的论证结构，并帮助作者借鉴优秀论文的组织方式。',
    content,
    maxTokens: 8000,
  };
}

function caption(c) {
  const { paper } = c;
  const prompt = [
    `Translate this Chinese figure or table caption from a research paper${paper.field ? ` in the field of ${paper.field}` : ''} into English.`,
    paper.glossary.length ? 'Glossary (use exactly these English terms):\n' + paper.glossary.map(g => `${g.zh} → ${g.en}`).join('\n') : null,
    `Spelling: ${paper.spelling === 'UK' ? 'British English' : 'American English'}.`,
    'Rules: write a concise academic caption in sentence case; keep LaTeX commands, math and citations exactly as written; escape %, &, # and _ outside math; reply with the caption only, without a "Figure" or "Table" prefix.',
    '',
    'Caption:',
    '<<<',
    c.text,
    '>>>',
  ].filter(x => x != null).join('\n');
  return { system: 'You translate Chinese academic writing into publication-quality English.', prompt, maxTokens: 400, fast: true };
}

const TASKS = { polish, translate, title, caption };

export function buildPrompt(task, body) {
  if (task === 'outline') return { task, ...outline(body && typeof body === 'object' ? body : {}) };
  const fn = TASKS[task];
  if (!fn) { const e = new Error('unknown task'); e.status = 404; throw e; }
  const c = readContext(body && typeof body === 'object' ? body : {});
  if (!c.text) { const e = new Error('text is required'); e.status = 400; throw e; }
  return { task, ...fn(c) };
}
