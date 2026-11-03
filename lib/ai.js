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
      messages: [{ role: 'user', content: job.prompt }],
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
    if (st === 400 || st === 404 || st === 422) return 'bad_request';
    return 'upstream_error';
  }

  return { ready: mock || !!client, mock, models, stream, errorCode };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mockStream(job, { signal, onText }) {
  const src = (job.prompt.split('<<<\n')[1] || '').split('\n>>>')[0];
  let out;
  if (job.task === 'polish') {
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
