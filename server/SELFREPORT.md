# TASK 1A 后端自检报告（Wave 1A）

环境：Node v22.23.1 / npm 10.9.8 / macOS。契约：`../design.md`。全部命令真实执行，输出摘录如下。

## 1. 测试命令与结果

```
cd server && npm install && npm test
```

```
# tests 29
# suites 0
# pass 29
# fail 0
# cancelled 0
# skipped 0
# duration_ms 1231.9
```

`npm run build`（tsc，NodeNext/strict）零错误，产物 `dist/` 正常生成。

覆盖明细（`src/tests/`，node:test + tsx）：
- `analyzer.test.ts`（5 例）：合成 PNG 验证 coverage=11.1%、bbox 归一化 0.333、中心格 grid=100%、最空格、双色 palette Top2 各 50%、多细线 edgeRatio > 单实心块、上/下三分之一空档数字
- `mock.test.ts`（11 例）：空白→high「画布几乎为空」+三分法 region；左 1/3 内容→high「构图失衡」且建议 region 在右侧；lineart edgeRatio<0.02→「线条过浅/断线」；color 色数≤1→「尚未上色」引用实测色数；detail 下 1/3 空→「背景缺失」region.y≥2/3；goal 一条且声明结构信号推断；每条 promptDraft 含数字+character+scope 限定语；strengths 恰 2 条带数字；score 空白<有内容；同输入两次评估 JSON 相等；simulateFail 抛错
- `mockgen.test.ts`（5 例）：6 个 scope 输出均可 pngjs 解回、尺寸与输入一致、像素有差异；两次生成逐字节相等（确定性）；pose 包围盒实际移动；background 空区>90% 被填充且内容像素原样保留；local 的 region 外（左上 60x60）逐像素不变
- `api.test.ts`（7 例）：真实 HTTP（临时端口+临时数据目录）冒烟 health/config/建项目/evaluate/prompt build（含带建议与 404）/generate（解回 480x300 PNG）/simulateFail 502 且延迟≥750ms/PUT rev 0→1→2 单调且落盘可重读/未知项目与路由 404 {error}

## 2. curl 冒烟（PORT=8903 `npm run dev`，真实输出）

```
$ curl -s localhost:8903/api/health
{"ok":true,"uptimeSec":12}

$ curl -s localhost:8903/api/config
{"mode":"mock","hasLlmKey":false,"hasImgKey":false,
 "mockNote":"mock 演示模式：评估与生成均基于服务端真实像素度量，确定性输出（模拟延迟 600ms）。配置 AI_PROVIDER=real 及 LLM/IMG key 可切换真实模型"}

$ curl -s -X POST localhost:8903/api/projects -d '{"title":"悬崖上的剑士","theme":"奇幻冒险","character":"红发少女剑士","goal":"少女在悬崖边眺望远方城堡的背影"}'
→ {"doc":{"meta":{...},"stage":"sketch","round":0,"rev":0,"snapshots":[1 条初始空白快照],...}}

# 输入：480x300 PNG，左 1/3 黑色竖条
$ curl -s -X POST localhost:8903/api/evaluate ...
→ {"evaluation":{"overall":{"score":64,"summary":"覆盖率 33.3%、主体占画面 33.3%、去重色数 1、边缘密度 0.001。主要问题：构图失衡。数据来自服务端像素度量。"},
   "issues":["high:构图失衡","low:目标一致性待确认"],
   "suggestions[0].promptDraft":"实测内容 100% 集中在左侧 1/3（质心 x=0.166）。请平移主体位置/微调姿态…角色「红发少女剑士」目标「少女在悬崖边眺望远…」…scope 限定：仅调整姿态与位置…"}}

$ curl -s -X POST localhost:8903/api/prompt/build ... {"scope":"pose","stage":"sketch","basePrompt":"把人物往右挪"}
→ {"templateName":"pose-fix","finalPrompt":"你是动画绘图师，执行姿态修正任务…【姿态修正任务·sketch 阶段】…实测数据：覆盖率 33.3%；主体包围盒占画面 33.3%；质心 (0.166,0.498)；去重色数 1；边缘密度 0.001…"}

$ curl -s -X POST localhost:8903/api/generate ... {"scope":"background"}
→ {"generation":{"mode":"mock","latencyMs":644,"image":"data:image/png;base64,iVBORw0K…"(2981 字节),
   "note":"mock 图生图：background 变换（主体像素保持不变，仅空区补背景）；右下角已叠加 MOCK·background修正 半透明标签标识"}}

$ time curl -s -w 'HTTP %{http_code}' -X POST localhost:8903/api/generate ... {"simulateFail":true}
→ HTTP 502 {"error":"MOCK 模拟生成失败（演示失败路径）","retryable":true}   # 0.812s ≈ 契约 800ms

# AI_PROVIDER=real 且 key 齐备（real.ts 属 Wave 2D，尚未存在）→ 如实回落：
$ curl -s localhost:8913/api/config   # (AI_PROVIDER=real LLM_API_KEY=… IMG_API_KEY=… 起的实例)
→ {"mode":"mock","hasLlmKey":true,"hasImgKey":true,
 "mockNote":"已配置 AI_PROVIDER=real 且 key 齐备，但真实 provider 尚未接入（Wave 2D 交付），当前回落 mock 演示模式"}
```

生成图视觉核验（图像模型读图确认）：pose 输出内容块可见平移+剪切；background 输出为天空渐变+地平线+圆月剪影且主体像素保留；右下角标签可读出 `MOCK·GLOBAL` 与「修正」二字。

## 3. 文件清单（作用一行一个）

- `package.json` — 包定义：name=collab-paint-server，type=module，dev/build/start/test 四脚本，依赖仅 express/cors/pngjs
- `tsconfig.json` — tsc 配置（NodeNext ESM、strict、outDir dist）
- `src/types.ts` — §2 核心数据模型，字段名与契约一致
- `src/ai/analyzer.ts` — pngjs 像素度量：coverage/bbox 质心/3x3 grid/桶32 调色板 Top6/edgeRatio/topEmpty/bottomEmpty/leftShare
- `src/ai/mock.ts` — Mock provider：§5.2 规则表评估（数字入文）、score 公式（注释在 computeScore）、MOCK_LATENCY_MS 延迟、simulateFail 唯一失败路径
- `src/ai/mockgen.ts` — §5.3 按 scope 真实像素变换（pose 平移剪切/contour 3x3 膨胀/color 色相旋转/background 渐变+地平线+圆月/local region 内混合/global 对比增强）+ 右下角半透明 `MOCK·<scope>修正` 点阵标签
- `src/ai/provider.ts` — AIProvider 接口 + 选择逻辑（env 条件满足时动态探测 real.ts，缺失则回落 mock；/api/config 如实报告）
- `src/prompts.ts` — 8 模板注册表、评估按 stage 组合、生成按 scope 选择、buildPrompt 组装（goal/character/fix/实测数字/限定语）
- `src/store.ts` — projects.json 原子持久化（tmp+rename、300ms 防抖、启动加载、快照上限 30 淘汰最旧）
- `src/app.ts` — Express 全部 §3 路由 + 60s 超时 + 502 {error,retryable} + 生产托管 ../web/dist（catch-all 最后 + 目录穿越防护）
- `src/index.ts` — 入口：PORT=8903 监听、SIGINT/SIGTERM 冲刷落盘
- `src/tests/helpers.ts` + 4 个 `*.test.ts` — 合成 PNG 工具与 29 个测试用例
- `data/.gitkeep` — 运行时数据目录占位（projects.json 已 gitignore）
- `.gitignore` — data 运行时文件 / node_modules / dist / .env（§10 红线）

## 4. 偏离项（对 design.md / 任务书）

1. **thumb 为宽 240 的 PNG 而非 JPEG**（§2 注释「thumb=宽240 JPEG」）：依赖白名单（express/cors/pngjs）内无 JPEG 编码器，纯 Node 手写 JPEG 编码器风险高收益低；前端 `<img>` 展示不受影响。
2. **新增 `src/app.ts`（应用工厂）与 `src/tests/helpers.ts`**：目录树未列出；测试需直接 import app（任务书允许「直接 import app」），拆出工厂便于临时端口/临时数据目录隔离，`index.ts` 仍是唯一入口。
3. **evaluate/generate 在服务端把结果追加进 doc 并 rev++**：契约未明说，但 §2 的 ProjectDoc 含 evaluations/generations/rounds（含 evaluationId/generationIds），且「快照历史可追溯」要求服务端留档。含义：客户端在这些操作后应 GET 刷新 doc 再发起 PUT（PUT 本就不校验冲突，序列化请求即安全）。
4. **real provider 用变量动态 import 探测**（而非 import real.ts）：real.ts 是 Wave 2D 交付物，本期不存在，静态 import 会编译失败；探测失败自动回落 mock 并在 /api/config 如实说明。2D 把 `src/ai/real.ts` 放进去即自动启用，无需改本文件。
5. **「修正」二字为 16x16 手绘点阵**：契约允许「简单 5x7 点阵字模，不必字体库」；5x7 无法表现 CJK，改用 16x16 近似字模（图像模型可辨识），ASCII 部分为标准 5x7。
6. **构图失衡建议的目标格**取「内容较轻一侧 3 格中最空者」（非全图最空格）：全图最空格可能落在中列，无法实现「往留白侧回移」的语义。

无其他偏离。mock 输出全部可追溯到实测像素数字（诚实性红线 §10），测试与冒烟均在真实执行下通过。
