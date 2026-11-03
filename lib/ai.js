// 调用 Claude API（流式）。AI_MOCK=1 时不调用 API，返回模拟结果，方便本地调试界面。
import Anthropic from '@anthropic-ai/sdk';

export function createAI() {
  const mock = process.env.AI_MOCK === '1';
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  const client = key && !mock ? new Anthropic({ apiKey: key, maxRetries: 2 }) : null;
  const models = {
    main: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
    fast: process.env.CLAUDE_FAST_MODEL || 'claude-haiku-5-5',
  };

  async function stream(job, { signal, onText }) {
    if (mock) return mockStream(job, { signal, onText });
    const s = client.messages.stream({
      model: job.fast ? models.fast : models.main,
      max_tokens: job.maxTokens,
      system: job.system,
      messages: [{ role: 'user', content: job.content || job.prompt }],
    }, { signal });
    s.on('text', onText);
    const msg = await s.finalMessage();
    if (msg.stop_reason === 'refusal') { const e = new Error('refused'); e.code = 'refused'; throw e; }
    return { truncated: msg.stop_reason === 'max_tokens' };
  }

  function errorCode(e) {
    if (e && e.code === 'refused') return 'refused';
    const st = e && e.status;
    if (st === 401 || st === 403) return 'bad_key';
    if (st === 429) return 'rate_limited';
    if (st === 529 || /overloaded/i.test(String(e && e.message))) return 'overloaded';
    if (st === 413 || (st === 400 && /too long|too large|context|pages|maximum/i.test(String(e && e.message)))) return 'too_long';
    if (st === 400 || st === 404 || st === 422) return 'bad_request';
    return 'upstream_error';
  }

  return { ready: mock || !!client, mock, models, stream, errorCode };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mockStream(job, { signal, onText }) {
  const src = ((job.prompt || '').split('<<<\n')[1] || '').split('\n>>>')[0];
  let out;
  if (job.task === 'outline') {
    await sleep(800);
    out = JSON.stringify({
      analysis: [{ source: '演示：参考文章 1', structure: '演示模式没有读取文章。真实结果会概括它从问题、方法到实验的论证顺序。' }],
      common: '先提出问题和不足，再给出方法，最后用实验验证并总结。',
      sections: [
        { titleZh: '引言', titleEn: 'Introduction', purpose: '提出问题并说明本文贡献', points: ['【研究对象】的重要性与应用场景', '现有方法在【关键难点】上的不足', '本文的方法与三点贡献'] },
        { titleZh: '相关工作', titleEn: 'Related Work', purpose: '梳理已有研究并定位本文', points: ['【方向一】的代表性方法', '【方向二】的进展与局限'] },
        { titleZh: '方法', titleEn: 'Methodology', purpose: '给出问题定义与模型设计', points: ['问题定义与符号说明', '【核心模块】的设计思路', '训练目标与优化方法'] },
        { titleZh: '实验', titleEn: 'Experiments', purpose: '验证方法的有效性', points: ['【数据集名称】与评价指标', '与基线方法的对比结果', '消融实验与参数分析'] },
        { titleZh: '结论', titleEn: 'Conclusion', purpose: '总结并展望', points: ['总结主要发现', '局限与未来工作'] },
      ],
    });
  } else if (job.task === 'polish') {
    out = `【润色】\n${src.replace(/，所以/g, '。因此，').replace(/很多人/g, '学界')}\n【批注】\n- 演示模式：没有调用 Claude，这里只做了简单替换\n- 配置 ANTHROPIC_API_KEY 后会得到真实的润色结果\n【论点】p1`;
  } else if (job.task === 'translate') {
    out = `[Demo translation — set ANTHROPIC_API_KEY for real output] ${src.slice(0, 60)}…`;
  } else {
    out = 'Demo Section Title';
  }
  const parts = out.match(/[\s\S]{1,6}/g) || [];
  for (const p of parts) {
    if (signal.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    onText(p);
    await sleep(25);
  }
  return { truncated: false };
}
