# 论文译写台

一个写论文用的网站：上方是**思路大纲**，下方逐段用中文写作。每段写完后，会先**润色中文逻辑**，再**译成可以直接放进 LaTeX 的英文**，最后可以导出到 Overleaf。

- 从参考文章生成大纲：上传 1 到 3 篇想借鉴写法的论文（PDF、.tex、.txt、.md），Claude 分析它们的论证逻辑，再按同样的组织方式为你的论文拟大纲，可以替换或追加到当前大纲
- 大纲：每节写下本节作用和要论证的观点；段落标注对应观点后，大纲里的圆点会变成实心，一眼看出哪些观点还没写
- 润色：参考本节大纲、上一段和学科领域，标出改动（绿色为新增，红色为删除），并用“批”字批注说明修正了哪些逻辑问题
- 翻译：学术英文，保留 `\cite{}`、公式等 LaTeX 命令，自动转义特殊字符；术语表里的词始终用你指定的译法
- 导出：复制本节或全文 LaTeX，或下载 Overleaf 项目 .zip（`main.tex` + `sections/*.tex`）
- 每篇论文有一个私密链接，可以换设备打开，也可以发给合作者一起改
- 同一篇论文在两个窗口同时修改时，后保存的一方会暂停保存并提示刷新，不会悄悄覆盖对方

## 本地运行

需要 Node.js 22.13 或更新版本。

```bash
npm install
cp .env.example .env      # 填入 ANTHROPIC_API_KEY
npm start                 # 打开 http://localhost:3000
```

只想先看界面、不调用 Claude：

```bash
AI_MOCK=1 npm start
```

## 部署上线

### 方案 A：Render + Neon（免费起步）

适合个人或小组使用。缺点是 Render 免费实例闲置 15 分钟后会休眠，下次打开要等大约一分钟。

1. 把这个文件夹推到你自己的 GitHub 仓库。
2. 在 [Neon](https://neon.com) 新建一个免费的 PostgreSQL 项目，复制连接串（以 `postgresql://` 开头）。
3. 在 [Render](https://render.com) 选 **New → Web Service**，连接上面的仓库：
   - Build Command：`npm install`
   - Start Command：`npm start`
4. 在 Render 的 **Environment** 里添加环境变量：
   - `ANTHROPIC_API_KEY`：你的 Claude API key
   - `DATABASE_URL`：第 2 步的 Neon 连接串
   - `ACCESS_CODE`：自己定一个访问码
5. 部署完成后，Render 会给你一个 `https://xxx.onrender.com` 网址，打开即可使用。也可以在 Render 里绑定自己的域名。

注意：Render 免费实例的本地磁盘在重启后会清空，所以**必须配置 `DATABASE_URL`**，不能用 SQLite。

### 方案 B：自己的服务器（Docker）

```bash
docker build -t paper-desk .
docker run -d --name paper-desk -p 3000:3000 \
  -e ANTHROPIC_API_KEY=你的key \
  -e ACCESS_CODE=你的访问码 \
  -v paper-desk-data:/data \
  --restart unless-stopped paper-desk
```

数据保存在 `paper-desk-data` 卷里的 SQLite 文件中。建议在前面加一层 Nginx 或 Caddy 提供 HTTPS（浏览器只有在 HTTPS 下才允许“一键复制”）。如果不加反向代理、直接对外开放端口，请把 `TRUST_PROXY` 设为 `0`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `ANTHROPIC_API_KEY` | **必填**。Claude API key，只保存在服务器上，浏览器拿不到 |
| `ACCESS_CODE` | **强烈建议**。设置后，打开网站要先输入访问码，防止陌生人消耗你的额度 |
| `DATABASE_URL` | 使用 PostgreSQL 时填写；不填则使用 SQLite |
| `SQLITE_PATH` | SQLite 文件位置，默认 `./data/paper-desk.db` |
| `CLAUDE_MODEL` | 润色与翻译用的模型，默认 `claude-sonnet-5-5`；想要更高质量可改为 `claude-opus-5-5` |
| `CLAUDE_FAST_MODEL` | 翻译章节标题用的模型，默认 `claude-haiku-5-5` |
| `AI_REQUESTS_PER_HOUR` | 每个 IP 每小时最多调用几次润色或翻译，默认 200 |
| `NEW_PAPERS_PER_HOUR` | 每个 IP 每小时最多新建几篇论文，默认 30 |
| `OUTLINES_PER_HOUR` | 每个 IP 每小时最多从参考文章生成几次大纲，默认 20 |
| `TRUST_PROXY` | 前面有几层反向代理，默认 1 |
| `AI_MOCK` | 设为 `1` 时不调用 Claude，返回模拟结果，用于调试界面 |

## 费用与安全

- 润色和翻译都用你的 API key 计费。按 `claude-sonnet-5-5` 的价格，一段约 200 字的中文，润色加翻译大约花 1 到 2 美分。
- 从参考文章生成大纲需要读完整篇 PDF，每页约几千 token。三篇各 20 页左右的论文，一次大约花 0.2 到 0.5 美元。
- 提示词都在服务器端拼装，浏览器只能提交论文内容，别人无法把你的网站当成通用的 Claude 接口来用。
- 论文链接里的 16 位编号是随机生成的，无法猜出。但拿到链接的人都能编辑，请只发给你信任的人。
- 没有设置 `ACCESS_CODE` 时，任何知道网址的人都能新建论文并消耗额度。

## 关于 Overleaf

目前通过导出与 Overleaf 配合：

1. 更新已有项目：复制本节 LaTeX，粘贴到 Overleaf 中对应的 `.tex` 文件。
2. 新建项目：下载 .zip，在 Overleaf 选 New Project → Upload Project。

自动双向同步需要 Overleaf 付费版的 Git 集成。之后可以在服务器上加一个任务，把英文稿定时推送到 Overleaf 项目的 Git 仓库。

## 目录结构

```
server.js          Express 服务器：页面、论文接口、润色与翻译接口
lib/store.js       存储（SQLite / PostgreSQL），带版本号防止互相覆盖
lib/prompts.js     润色、翻译、标题翻译的提示词
lib/ai.js          调用 Claude API（流式输出）
lib/example.js     示例论文
public/            前端页面（index.html、app.js、style.css）
```
