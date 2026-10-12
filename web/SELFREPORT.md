# SELFREPORT — Wave 1B 前端骨架与画布引擎

## 做了什么

- **脚手架**：Vite 5 + React 18 + TS（strict），`web/` dev 端口 8904，proxy `/api`→`http://localhost:8903`。依赖仅 react/react-dom/vite/@vitejs/plugin-react/typescript/@types/*，无 UI 组件库。
- **类型**：`src/types.ts` 与 design.md §2 逐字段一致（外加 §3 响应形状的辅助类型 HealthInfo/ConfigInfo/PromptBuildResult/EvaluateMetrics）。
- **API client**：`src/api/client.ts` 覆盖 §3 全部 8 个端点；502 带 `retryable:true` 与网络层失败抛 `ApiError{status,retryable}`。
- **画布引擎**（`src/canvas/engine.ts`，框架无关类）：
  - 960x600 逻辑画布 + devicePixelRatio 适配；白纸色 `#FDFDFB` 底。
  - 双层结构：paint 层（真实笔迹、导出唯一来源）+ overlay 层（点状参考网格，永不进导出）。
  - Pointer Events + setPointerCapture + `touch-action:none`；画笔圆头线 1..40px；橡皮 `destination-out`；中点二次贝塞尔平滑。
  - 撤销/重做：矢量笔迹/整图替换两类条目重放，栈上限 40（溢出烘焙进底图，重放代价有界）；新绘制清空 redo。
  - 导出：`getImageForAI()` 480x300 PNG；`getFullImage()` 960x600 全幅 PNG；`getThumb()` 240x150 JPEG q0.8（JPEG 补白底防黑透明）。
  - `applyImage(dataURL)`：采纳生成图 = 整幅替换且可撤销（AI 不无声改画布）。
- **状态管理**（`src/state/`）：context + useReducer 存 ProjectDoc；PUT 防抖 800ms；可重试失败自动重试 2 次（退避）；请求序列号丢弃过期响应；服务端 rev 存 ref 仅在发送时合入（避免 rev 回写触发保存循环）；health 15s 轮询 + config 载入，失败如实显示离线，不 mock。
- **UI**（styles/ 三份 CSS，设计变量集中 variables.css，§7 配色）：
  - 顶栏：项目名 + 主题/角色/目标 chips + 4 阶段切换器 + 模式徽章（config.mode，mock→「Mock 演示模式」）+ 健康徽章 + Round N。
  - 左工具栏：画笔/橡皮高亮互斥、8 色板 + 自定义 color input、竖向粗细滑条 1..40、撤销/重做/清空（window.confirm 二次确认）、网格开关；禁用态全部接 mirror 真值。
  - 中央画布 + 状态条（strokes 计数、离线提示、保存四态）。
  - 无项目 → 居中创建表单（4 字段必填校验，动画场景 placeholder）；创建成功进工作台（初始空白快照由 server POST /api/projects 生成）。
  - `src/ai/AIPanel.tsx`、`src/history/HistoryBar.tsx`「即将上线」占位（props 签名冻结）；`src/status/Toast.tsx` 已可用并接保存失败重试。
- `web/INTEGRATION.md`：Wave 2C 集成契约（引擎 API / context 形状 / 占位签名 / 状态条事件 / 样式规约）。

## 自验结果（真实运行）

```
npm install        → ok（npm audit 提示 vite5 生态 advisories，非本项目依赖错误）
npm run build      → tsc -b && vite build 零错误零警告
                   → dist/index.html 0.40kB / css 6.91kB / js 160.85kB(gzip 52.59kB)
npm run dev        → Vite ready in 92ms，Local: http://localhost:8904/
curl localhost:8904 → 200，HTML 正常返回
curl /src/main.tsx /App.tsx /canvas/engine.ts /state/AppProvider.tsx → 全部 200（vite 转换无错）
```

后端（8903）Wave 1A 尚未落盘/未启动，页面按预期显示离线徽章与健康轮询，创建表单在 server 缺席时如实展示创建失败错误——未 mock 任何真实调用。

## 偏离项

1. **`getThumb()` 命名**：任务书要求画布引擎对外 API 含「快照用 240 宽 JPEG thumb」，实现为 `getThumb()`（`getFullImage()` 之外补充），已在 INTEGRATION.md 文档化——非契约改名，属补充方法。
2. **undo 实现**：任务书写「每笔存 stroke 快照」，实现为**矢量笔迹重放**而非位图快照（40 条 960x600 位图 ≈ 90MB 内存不可接受）；「快照」语义保留（每笔一条记录、可撤销/重做），溢出条目烘焙进底图保证有界。
3. **健康轮询间隔**：契约未规定，取 15s；config 载入失败时模式徽章显示「模式未知（后端未连接）」而非假设 mock。
4. **React 18.3 ref-cleanup**：为兼容 StrictMode 双挂载，CanvasSurface 用 useEffect 创建/销毁引擎而非 ref 返回 cleanup（后者需 React 19 稳定语义）。

## 未做（按任务边界）

- 右侧 AI 面板与底部历史条的具体功能（Wave 2C）；本波次只交付占位 + 冻结签名。
- git 操作（PM 负责）。
