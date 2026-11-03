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
      glossary: (Array.isArray(p.glossary) ? p.glossary : []).slice(0, 200)
        .map(g => ({ zh: S(g && g.zh, 80).trim(), en: S(g && g.en, 160).trim() }))
        .filter(g => g.zh && g.en),
    },
    section: {
      index: Number.isInteger(sec.index) && sec.index >= 0 ? sec.index : 0,
      titleZh: S(sec.titleZh, 200).trim(),
      titleEn: S(sec.titleEn, 200).trim(),
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
    `当前章节：第 ${section.index + 1} 节「${section.titleZh || '未命名'}」`,
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

const TASKS = { polish, translate, title };

export function buildPrompt(task, body) {
  const fn = TASKS[task];
  if (!fn) { const e = new Error('unknown task'); e.status = 404; throw e; }
  const c = readContext(body && typeof body === 'object' ? body : {});
  if (!c.text) { const e = new Error('text is required'); e.status = 400; throw e; }
  return { task, ...fn(c) };
}
