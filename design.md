# 动画 AI 协作绘画编辑器 MVP — 设计契约（v1）

本文件是所有实现波次的唯一契约。实现代理必须严格遵守本文件的 API 形状、类型、目录与行为规范。
如现实约束确需偏离，必须在任务报告中显式列出偏离项，不得静默变更契约。

## 0. 产品定位

动画创作工作室风格的「人工主导、AI 辅助、用户确认」绘画协作编辑器。
核心闭环：创建画布 → 人工绘制 → AI 评估 → 反馈/建议（接受/拒绝/调整）→ 生成修正版 → 对比 → 采纳 → 下一轮。
不是聊天工具加画布：AI 反馈必须绑定具体建议项、具体区域、具体修改范围（scope），并通过快照历史形成可追溯迭代。

优先级（题目原文）：完整绘画协作闭环 > 人机交互设计质量 > 阶段驱动 Prompt 设计 > 界面视觉质量 > 真实 AI 接入。

## 1. 技术栈与目录

- 前端：React 18 + TypeScript + Vite，位于 `web/`，dev 端口 8904（vite proxy /api → 8903）。
- 后端：Node 24 + Express + TypeScript（tsx 运行 dev，tsc 构建），位于 `server/`，端口 8903。
- 生产模式：`server` 托管 `web/dist` 静态文件（注意：不得用 mount("/") 吃掉 /api 路由，catch-all 路由放最后，含目录穿越防护）。
- 持久化：`server/data/projects.json` 单文件 JSON（原子写 tmp+rename，300ms 防抖），无数据库。
- 唯一后端额外依赖：express、pngjs、cors、tsx(devDep)、typescript(devDep)、@types/*(devDep)。禁止引入数据库/队列/多 Agent 框架。
- 前端依赖只用：react、react-dom、vite、@vitejs/plugin-react、typescript。不引 UI 组件库（自己写样式，统一设计系统变量）。

```
tiB_test/
  design.md            # 本契约
  README.md            # 面向评审：快速体验指引 + 部署说明
  REPORT.md            # 交付报告（PM 撰写）
  TIMELOG.md           # 波次时间与 token 记录（PM 撰写）
  TASKS/               # 各波次任务书
  logs/                # 委派代理运行日志（json）
  server/
    package.json  tsconfig.json  src/
      index.ts          # Express 入口、路由、静态托管
      types.ts          # 与本契约一致的类型
      store.ts          # JSON 文件持久化
      prompts.ts        # 阶段×任务 Prompt 模板注册表
      ai/
        provider.ts     # AIProvider 接口
        mock.ts         # Mock provider（真实像素分析，非固定文案）
        real.ts         # OpenAI 兼容真实 provider（Wave 2D）
        analyzer.ts     # pngjs 画布像素度量
        mockgen.ts      # Mock 图像生成（真实像素变换）
      tests/*.test.ts   # node:test
  web/
    package.json  tsconfig.json  vite.config.ts  index.html
    src/
      main.tsx  App.tsx  styles/  api/client.ts  types.ts
      canvas/           # 画布引擎（Wave 1B）
      ai/               # AI 面板/建议/生成/对比（Wave 2C）
      history/          # 快照/轮次/恢复（Wave 2C/1B 槽位）
      status/           # toast/请求状态（Wave 1B 槽位，2C 使用）
```

## 2. 核心数据模型（TypeScript，两端一致）

```ts
type Stage = 'sketch' | 'lineart' | 'color' | 'detail';   // 草稿构图→线稿→上色→细化
type Severity = 'high' | 'medium' | 'low';
type IssueKind = 'composition' | 'consistency' | 'pose' | 'contour' | 'color' | 'background' | 'goal';
type Scope = 'pose' | 'contour' | 'color' | 'background' | 'local' | 'global';
interface Region { x: number; y: number; w: number; h: number; }  // 归一化 0..1

interface ProjectMeta {
  id: string; title: string; theme: string;       // 动画主题
  character: string;                               // 角色设定
  goal: string;                                    // 画面目标
  createdAt: number;
}

interface Issue { id: string; kind: IssueKind; severity: Severity; title: string; detail: string; region?: Region; }

interface Suggestion {
  id: string; basedOnIssue?: string;
  kind: IssueKind; scope: Scope; severity: Severity;
  title: string; problem: string; reason: string; fix: string;   // 具体问题/修改理由/可执行建议
  region?: Region;
  promptDraft: string;        // 生成任务提示词草稿（含度量数字，禁止空话）
}

interface Evaluation {
  id: string; round: number; stage: Stage; provider: string; mode: 'mock' | 'real'; latencyMs: number;
  overall: { score: number; summary: string };     // score 0..100
  strengths: string[];
  issues: Issue[];
  suggestions: Suggestion[];
}

interface Generation {
  id: string; round: number; suggestionId?: string; scope: Scope;
  prompt: string;                     // 实际发送的最终 prompt（用户可改过）
  provider: string; mode: 'mock' | 'real'; latencyMs: number;
  image: string;                      // PNG dataURL
  note: string;                       // 是否图生图/局部重绘、保留性说明
}

interface Snapshot { id: string; round: number; stage: Stage; image: string; thumb: string; createdAt: number; label: string; } // image=PNG dataURL 全幅；thumb=宽240 JPEG

interface RoundRecord { round: number; stage: Stage; evaluationId?: string; generationIds: string[]; decisions: { type: 'accept'|'reject'|'adjust'|'adopt'|'restore'; targetId: string; note?: string; at: number }[]; }

interface ProjectDoc { meta: ProjectMeta; stage: Stage; round: number; rev: number; snapshots: Snapshot[]; evaluations: Evaluation[]; generations: Generation[]; rounds: RoundRecord[]; }
```

约束：snapshots 最多保留 30 条全幅（超出淘汰最旧的非当前）、thumb 不限；rev 单调递增，客户端拿到返回 rev 再发下一次。

## 3. API 契约（全部 JSON；图片一律 dataURL 字符串；除注明外均 POST）

- `GET /api/health` → `{ok:true, uptimeSec}`
- `GET /api/config` → `{mode:'mock'|'real', hasLlmKey:boolean, hasImgKey:boolean, llmModel?:string, imgModel?:string, mockNote:string}`（绝不回传 key）
- `POST /api/projects` `{title,theme,character,goal}` → `{doc:ProjectDoc}`（round=0, stage='sketch', 初始空白快照）
- `GET /api/projects/:id` → `{doc}`（404 → `{error}`)
- `PUT /api/projects/:id` `{doc}` → `{doc}`（服务端 rev++ 后落盘；不校验冲突，客户端序列化请求即可）
- `POST /api/evaluate` `{projectId, round, stage, image, metrics:{strokes, sessionMs}}`（image=480x300 PNG dataURL）→ `{evaluation:Evaluation}`
  - 评估失败（真实 provider 超时/解析失败）→ 502 `{error, retryable:true}`；mock 模式不失败。
- `POST /api/prompt/build` `{projectId, suggestionId?, scope, stage, basePrompt, image}` → `{system,user,finalPrompt,templateName}`（模板特调入口，返回内容仅用于展示/编辑，不落盘）
- `POST /api/generate` `{projectId, round, suggestionId?, scope, prompt, image, region?, simulateFail?}` → `{generation:Generation}`
  - `simulateFail:true` → 800ms 后 502 `{error:'MOCK 模拟生成失败（演示失败路径）', retryable:true}`（用于演示失败/重试 UI）
  - 正常失败同样 502 + retryable 标记。
- 评估与生成必须并发安全：服务端无全局锁，但单请求内 async 完成后才响应；客户端负责 in-flight 防重入。

## 4. AI Provider 接口

```ts
interface AIProvider {
  name: string; mode: 'mock' | 'real';
  evaluate(input: { meta: ProjectMeta; stage: Stage; round: number; image: Buffer; metrics: { strokes: number; sessionMs: number } }): Promise<Evaluation 去掉 id/latency 的部分>;
  generate(input: { meta: ProjectMeta; stage: Stage; scope: Scope; prompt: string; image: Buffer; region?: Region; simulateFail?: boolean }): Promise<{ image: Buffer; note: string }>;
}
```

选择逻辑：env `AI_PROVIDER=real` 且 LLM/IMG key 齐备才用 real，否则自动回落 mock 并在 /api/config 如实报告。key 只从服务端 env 读：`LLM_API_KEY, LLM_BASE_URL, LLM_MODEL`；`IMG_API_KEY, IMG_BASE_URL, IMG_MODEL`。

## 5. Mock 行为规范（最重要的评分点之一）

Mock 不是固定文案。它必须基于真实像素度量产生「看起来经过分析」的结果，且确定性（同一输入同一输出，禁 RNG；延迟用 env `MOCK_LATENCY_MS` 默认 600ms 模拟）。

### 5.1 analyzer.ts（pngjs 解码后计算，全部可单测）
- coverage：非白(alpha>0 且非近白)像素占比 %
- bbox：内容包围盒（归一化）与质心
- grid：3x3 每格占用率，找出最空格
- palette：量化(桶32)后的 Top6 颜色及占比、去重色数
- edgeRatio：局部对比度代理（相邻像素亮度差>阈值比例）→ 线条浓度
- bottomEmpty / topEmpty：上/下三分之一占用

### 5.2 mock.evaluate 规则表（stage 感知，示例——实现可扩充但必须同构：条件→真实数字→具体建议）
- coverage<2%：high『画布几乎为空』composition，建议先画主体剪影（给出目标构图三分法位置 region）
- 质心偏离中心带(x<0.35 或 >0.65)：high『构图失衡』，region=最空格，promptDraft 带实测『内容 78% 集中在左侧 1/3』
- lineart 阶段 edgeRatio<0.02：medium『线条过浅/断线』contour
- color/detail 阶段色数≤1：medium『尚未上色』color（引用实测色数）
- color/detail 阶段某单色占比>85% 且色数>3：low『色彩失衡』color
- detail 阶段 bottomEmpty>0.9：medium『背景缺失』background，region=下 1/3
- 主体 bbox 占画面 <15% 且 coverage>8%：medium『主体偏小/姿态不完整』pose
- goal 一致性：基于 coverage/bbox 与用户 goal 文本长度等可解释信号给 goal 类一条（写明这是结构信号推断）
- strengths：从实测里挑 2 条正面事实（如『覆盖率 34%，画面信息量充足』）
- overall.score：coverage/构图居中度/色数/阶段权重合成，公式写进代码注释
- 每条 suggestion.promptDraft 必须包含至少一个实测数字 + 用户 character/goal 摘要 + scope 限定语。

### 5.3 mockgen.ts（真实像素变换，按 scope）
- pose：内容 bbox 内像素做平移+轻剪切（可见的姿态/位置变化）
- contour：对暗像素做 3x3 膨胀加粗（线条更实）
- color：内容区色相向建议目标旋转、饱和度+10%
- background：空区填充双色柔和渐变 + 由 bbox 统计派生的地平线/圆月等简单剪影
- local：仅 region 内应用 color/contour 混合；global：全图轻对比增强
- 一律在右下角叠加半透明标签 `MOCK·<scope>修正`（诚实标识）
- 输入 480x300 → 输出同尺寸 PNG Buffer。

## 6. 阶段 × Prompt 模板（prompts.ts 注册表，服务端唯一来源）

模板名：`composition-eval / consistency-eval / pose-fix / contour-fix / color-harmony / background-fill / local-edit / style-unify`。
- 评估模板按 stage 组合：sketch→composition+goal；lineart→composition+consistency+contour；color→consistency+color+goal；detail→全维度。
- 生成模板按 scope 选择，必须拼入：用户 goal、character、建议的 fix、实测数字、scope 限定语（例：『仅调整姿态，保持轮廓、配色与背景不变』）。
- `/api/prompt/build` 返回 system/user/finalPrompt/templateName；UI 展示且可编辑，编辑后的文本才是发送内容。

## 7. UI 契约（web/）

布局（深色工作室风格，设计变量集中在 styles/variables.css：底色 #17181C、面板 #1F2127、主强调 #F5A623、成功 #35C48D、高危 #E5484D、圆角/阴影统一）：
- 顶栏：项目名 + 主题/角色/目标摘要 chips + 阶段切换器（4 阶段）+ 模式徽章（Mock 演示模式 / 真实模型）+ 轮次 Round N
- 左侧竖向工具栏：画笔/橡皮/颜色板(8色+自定义)/笔刷大小滑条/撤销/重做/清空（清空需确认）；当前工具高亮
- 中央：画布 960x600（白纸色艺术板、点状参考网格可开关），下方状态条（strokes 计数、可评估提示）
- 右侧 AI 协作面板（核心，Tab 或分区块）：① 评估区（触发按钮 + 阶段提示 + 进行中/结果/失败重试态）② 建议列表（severity 徽章、kind 图标、问题/理由/fix、region 高亮联动画布、接受/拒绝/调整按钮；接受的建议进入"待生成"）③ 生成区（prompt 预览/编辑、scope 选择、模拟失败开关、生成按钮 → 对比视图）
- 底部历史条：快照缩略图横向滚动（round+stage 标签、悬停放大、点击预览、可恢复=以新快照落盘当前画布再载入所选），右侧轮次时间线摘要（每轮：评估/生成/决策计数）
- 交互硬规则：
  - 所有异步动作有 idle/loading/success/error(+重试) 四态可视；按钮 in-flight 禁用；用请求序号丢弃过期响应
  - AI 永不直接改画布；只有用户点「采纳」才把生成图画上（并自动存快照）
  - 自动评估触发=关键节点（切阶段、每 25 笔）出现呼吸灯提示条，由用户一键确认执行（人工主导）
  - 生成结果对比：左右并排原图/修正版 + 各自标签（provider/mode/scope/note），采纳/放弃按钮；采纳后 Round+1 并记录
  - 空状态引导文案完整（无项目→创建表单；无评估→引导先绘制再评估）

## 8. 并发与失败处理规范

- 客户端：每类动作（evaluate/generate/save）in-flight 锁 + 序号防乱序；失败 toast 可重试；保存失败静默重试 2 次后提示
- 服务端：evaluate/generate 各自带 60s 超时；真实 provider 失败回落结构化 502（见 §3）；mock 永不失败（除 simulateFail）
- 清空/恢复等破坏性操作必须二次确认；恢复以"新增快照"实现，绝不覆盖历史

## 9. 各波次验收门（PM 亲自执行，代理自测不算数）

- Wave 1A（server）：`npm test` 全绿；curl 冒烟：建项目→evaluate（返回结构含实测数字）→prompt/build→generate（返回 PNG dataURL）→simulateFail 502
- Wave 1B（web）：`npm run build` tsc+vite 零错；dev 起服务可鼠标绘制/撤销/重做/换色换粗细；创建项目表单完整；与 server 联通 health 徽章
- Wave 2C：浏览器真实 E2E：绘制→评估→建议接受/拒绝→prompt 编辑→生成→对比→采纳→Round+1→历史恢复，全链路真实点击
- Wave 2D：`AI_PROVIDER=real` 时 config 如实；无 key 自动回落 mock；单测用 fetch stub 覆盖成功/超时/坏 JSON
- Wave 3（PM）：构建生产模式 → cloudflared 公网 → GitHub 公开仓库 → 逐文件匿名 curl 验证

## 10. 诚实性红线

- Mock 输出必须可追溯到实测像素数字；禁随机禁固定套话
- UI 必须明示当前 mode（mock/real）与生成结果的 note（能否保留原图）
- REPORT.md 的 token/时间只写真实记录，拿不到写「未统计」
- 仓库不得出现任何 API key / 个人信息；.env 进 .gitignore
