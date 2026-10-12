# TASK 2C — AI 协作面板 + 历史闭环（Wave 2）

你是本项目的前端第二波实现代理。契约：`../design.md`（先完整读）。上一波已交付 `web/` 骨架，其集成契约见 `web/INTEGRATION.md`（必读）。

## 所有权（严格）

- 只允许创建/修改：`web/src/ai/**`、`web/src/history/**`、`web/src/status/**`（若上一波已建占位则原地替换实现）、`web/src/App.tsx`、`web/src/styles/**`、`web/src/state/**`（仅在 AppProvider 追加新 action，如 patchDoc 类的 evaluations/generations/snapshots/rounds 写入，保持已有签名不变——契约见 web/INTEGRATION.md §2）、`web/src/api/client.ts`（只允许追加函数，不改已有签名）
- 禁止修改：`web/src/canvas/**` 画布引擎内部实现（发现 bug 报告，不要自行改）、`web/src/api/client.ts` 端点形状（缺能力可加函数，不改已有签名）、`server/**`、git
- 与 Wave 2D（另一代理在写 server/src/ai/real.ts）并行，别动 server

## 交付内容

把 design.md §7 右侧 AI 面板与底部历史条从占位变成真实现：

1. **评估区**：触发按钮（in-flight 禁用+spinner）→ 调 /api/evaluate（用画布引擎 getImageForAI + strokes 计数）→ 四态渲染（idle/loading/success/error+重试）。结果：overall 分数条、summary、strengths、issues 列表（severity 徽章+kind）
2. **建议列表**（协作核心）：
   - 每条：severity 徽章、kind、问题(problem)、理由(reason)、修改建议(fix)、实测数字高亮
   - region 联动：hover/选中建议时画布上叠加半透明高亮框（坐标归一化→画布像素）
   - 决策按钮：接受（进入待生成队列，列表标「已接受」）/ 拒绝（标灰「已拒绝」）/ 调整（弹 promptDraft 编辑，保存后同样可接受）
   - 决策写入 doc.rounds[].decisions 并 PUT 保存
3. **生成区**：
   - 选定一条已接受建议（或手动 scope）→ 展示 promptDraft 可编辑 textarea（用户改后的文本才是发送的）
   - scope 选择器（pose/contour/color/background/local/global）、「模拟生成失败」开关（演示失败路径）
   - 生成按钮 → /api/generate → 对比视图：左右并排 原画布 vs 修正版（provider/mode/scope/note 标签），按钮「采纳」/「放弃」
   - 失败态：错误横幅 + 重试按钮（可改 prompt 再试）
   - 采纳：调画布 applyImage(generation.image) → 自动存快照（全幅+thumb）→ round+1 → rounds 记录 adopt 决策 → PUT 保存 → toast 成功
4. **自动评估提示**：阶段切换或每 25 笔后出现呼吸灯提示条「建议在此节点请求 AI 评估」+ 一键执行按钮（人工确认才跑，绝不自动发）
5. **底部历史条**：快照缩略图横滚（round+stage 标签）、hover 放大、点击大图预览（可关闭）、「恢复到此快照」按钮（二次确认；先存当前画布为新快照再载入所选，绝不覆盖历史）；右侧每轮摘要（评估/生成/决策计数）
6. **toast/状态系统**（src/status/）：统一 toast（success/error/info、自动消失、可叠放）；每类请求防重入锁 + 响应序号丢弃过期
7. `npm run build` 零错误。写 `web/SELFREPORT-2C.md`：实现清单、与 INTEGRATION.md 的偏差、偏离项

## 自验

```
cd web && npm run build
```
有 server 在 8903 跑时可手工点通全流程（PM 会做全链路 E2E，你至少要 build 零错 + 自查状态机逻辑写完）。

## 完成标志

build 零错 + SELFREPORT-2C.md + 所有占位组件已被真实现替换。
