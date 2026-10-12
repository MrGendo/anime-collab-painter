# SELFREPORT — Wave 2C AI 协作面板 + 历史闭环

## 实现清单

### 1. 评估区（`ai/AIPanel.tsx` §①）
- 触发按钮：in-flight 禁用 + spinner；画布为空时禁用并给引导文案（空状态引导契约 §7）。
- 请求：`/api/evaluate`，image 用 `engine.getImageForAI()`（480x300 PNG），metrics 用 `engine.strokes` + 会话起点至今的 `sessionMs`。
- 四态：idle（含无评估引导）/ loading / success / error（横幅 + 重试按钮，重试走最新闭包经 ref 转发）。
- 结果渲染：overall 分数条（0-100，≥75 绿 / ≥50 橙 / 其余红，宽度动画）、summary、strengths 列表、issues 列表（severity 徽章 + kind chip + 标题/详情，悬停 issue 同样联动画布区域高亮）。

### 2. 建议列表（§②，协作核心）
- 每条卡片：severity 徽章、kind 图标+中文、title、问题/理由/建议三行、生成提示词草稿（details 折叠）、目标区域标记。
- **实测数字高亮**：`ai/labels.tsx#highlightNumbers` 把文本中数字片段（含 %/px/°）包成 `num-hl` 高亮 span。
- **region 联动**：`ai/RegionOverlay.tsx` 把归一化 region 换算为 `.canvas-host` 实时视口像素，fixed 定位叠加半透明高亮框（high 红/medium 橙/low 灰）；悬停即显、点击卡片固定（pin），resize/滚动重算；纯 overlay，不改画布引擎、不进导出。
- 决策按钮：接受（进待生成队列，标「✓ 已接受 · 待生成」）/ 拒绝（卡片标灰「已拒绝」，可重新接受）/ 调整（内联编辑 promptDraft，「保存并加入待生成」；空稿回落原始草稿）。
- 决策写入 `doc.rounds[当前轮].decisions`（accept/reject/adjust），经新增 `mutateDoc` action 走 Wave 1B 的 800ms 防抖 PUT 管线自动保存；建议的 UI 决策状态由 `state/docOps.ts#deriveSuggestionDecisions` 从 decisions 反推（后写覆盖先写），**刷新/重载后完整还原**，adjust 的编辑稿存 decision.note 并优先生成使用。

### 3. 生成区（§③）与对比
- 生成对象：已接受建议 chips（点击自动填入 调整稿||promptDraft 并锁定其 scope）或「手动」；prompt textarea 全程可编辑——**编辑后的文本才是实际发送内容**。
- scope 选择器 6 项（pose/contour/color/background/local/global）；「模拟生成失败」开关（发送 `simulateFail:true`，服务端 800ms 后 502）。
- 「套用服务端模板」按钮调 `/api/prompt/build`，返回 finalPrompt 填入 textarea 并 toast 显示 templateName（§6 的 UI 展示且可编辑）。
- 生成按钮 in-flight 禁用 + spinner；失败态：错误横幅 + 重试（textarea 未锁定，可改 prompt 再试）。
- 对比视图：居中弹层左右并排 原画布（发送时的同一份 480x300 图）vs 修正版，标签 provider/mode/scope/note（note 为保留性说明），「采纳」「放弃」按钮。
- **采纳**：`engine.applyImage(gen.image)` → 自动快照（`getFullImage` 全幅 + `getThumb` 240 JPEG）→ round+1 → 旧轮记 adopt 决策、新轮记录就位 → 防抖 PUT → toast「已采纳修正版，进入 Round N」。AI 永不直接改画布。

### 4. 自动评估提示（人工主导）
- 触发条件：阶段切换（首次载入不触发）/ 每 25 笔（`onStrokeDone` 计数，同一里程碑只提示一次）。
- 呼吸灯提示条（accent 脉冲动画）+「立即评估」一键执行 + 关闭；**绝不自动发请求**。

### 5. 底部历史条（`history/HistoryBar.tsx`）
- 快照缩略图横滚：R{round}·{stage 中文} 标签，新快照自动平滑滚到最右。
- hover 放大：fixed 浮层贴缩略图上方显示全幅图 + label。
- 点击大图预览弹层：全幅大图 + 元信息，「恢复到此快照」（红）+ 关闭，支持 Esc / 点击遮罩关闭。
- **恢复**：二次确认（说明当前画面会先另存）→ 先导出当前画布为备份快照 → 再 `applyImage` 载入所选 → 当前轮记 restore 决策 + 备份快照入列（30 条上限淘汰最旧，最新即当前永不淘汰）→ 历史只增不减。
- 右侧轮次摘要 chips：每轮 评估/生成/决策 计数（当前轮 accent 高亮，hover 有明细 tooltip）。

### 6. toast/状态系统（`status/`）
- `ToastProvider`：统一 toast（success/error/info），自动消失（默认 4s / error 8s）、可叠放（上限 5 条丢最旧）、error 可带重试；**ToastHost 组件与 ToastItem 签名零改动**（INTEGRATION §3），仅在其外层管理 items 生命周期。
- Wave 1B 的 ToastLayer 迁移为 `SaveErrorToast`（保存最终失败汇入统一 toast，只在进入失败态时提醒一次）。
- `useGuardedRequest`：每类动作（评估/生成/模板）独立实例 = in-flight 防重入锁 + 请求序号丢弃过期响应（reset 会作废在途响应），phase 驱动四态 UI。
- `EvalHint`：状态条右侧「可评估提示」（读 `mirror.empty`，可评估时绿点呼吸）。

### 7. state 层扩展（保持既有签名不变）
- `appState.ts` 追加 `docUpdated` action；`AppProvider` 追加 `mutateDoc(fn)`（INTEGRATION §2 所述"新增 action"形态），内部经 ref 读最新 doc 防旧闭包覆盖，改完自动走既有防抖保存。
- 新增 `state/docOps.ts` 纯函数：appendEvaluation / appendGeneration / appendSnapshot（30 条上限）/ recordDecision / adoptGeneration / recordRestore / deriveSuggestionDecisions / uuid（crypto.randomUUID + 降级）。
- `api/client.ts` 未改动（现有 8 端点全部够用，无需追加函数）。

## 自验结果（真实运行）

```
cd web && npm run build
→ tsc -b && vite build 零错误零警告
→ dist/index.html 0.40kB / css 18.56kB(gzip 4.16) / js 181.00kB(gzip 59.33)

vite dev 临时端口冒烟：/ 与 App/AIPanel/labels/RegionOverlay/HistoryBar/
ToastProvider/useGuardedRequest/EvalHint/docOps/AppProvider 及 ai.css 全部 200（模块转换无错）
```

状态机自查（无 server 手工点击，逐项走查）：评估四态与防重入 ✓；决策链 accept→reject→adjust 后写覆盖先写、重载还原 ✓；adjust 空稿回落 ✓；生成失败（simulateFail 502）横幅+重试+改稿再试 ✓；采纳顺序 applyImage→快照→round+1→决策→PUT→toast ✓；恢复先备份后载入、历史只增 ✓；25 笔/切阶段提示一次性触发、人工确认才发 ✓；保存失败 toast 重试一次提醒不刷屏 ✓。全链路浏览器 E2E 由 PM 执行（Wave 2C 验收门）。

## 与 INTEGRATION.md 的偏差

1. **可评估提示的位置**（§4 建议改 StatusBar.tsx）：`components/` 不在本波所有权清单内，故实现为 `status/EvalHint.tsx`，由 App.tsx 渲染进 statusbar 槽位（右侧），同样直接读 `useCanvas().mirror.empty`——design §7「状态条含可评估提示」语义完整满足，仅文件归属不同。
2. **ToastLayer → ToastProvider**（§3 建议"提升为 context"）：按建议实施；ToastHost 默认导出与 props 签名未动。
3. **对比视图为居中弹层**而非 340px 面板内嵌：design §7 只约束"左右并排 + 标签 + 采纳/放弃"，弹层保证两图可读尺寸；属展示位置选择，非契约偏离。

## 偏离项 / 说明

1. 决策/评估/生成/采纳后的「PUT 保存」走 Wave 1B 既有 800ms 防抖管线（INTEGRATION §2 规定路径），非即时 PUT；关键操作后约 0.8s 内落盘。
2. 「调整」语义按任务书"保存后同样可接受"实现为：保存调整稿即进入待生成（decisions 记 adjust，note=编辑稿），后续仍可再调整或拒绝。
3. 恢复/清空类二次确认沿用 Wave 1B 既有的 `window.confirm` 模式，保持一致。
4. 新样式文件（status/ai/history.css）由 App.tsx 引入——main.tsx 不在本波所有权内；且因 main.tsx 的 import 顺序（App 先于样式表），涉及覆盖 base.css 的两处布局（历史行 56→74px、statusbar 槽位改 flex）直接改在 base.css（styles/** 所有权内），新文件只含新选择器。
5. 生成请求的 region 仅当来源建议带 region 时传（任意 scope 都随请求发送，服务端/局部重绘自行取用）。
6. 快照 30 条上限由客户端 `appendSnapshot` 执行（design §2 约束；服务端 PUT 不校验，由本实现保证）。

## 未做（按任务边界）

- server/**（Wave 2D 并行）、canvas/** 内部（未发现需上报的 bug）、components/**、git。
