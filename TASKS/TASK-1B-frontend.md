# TASK 1B — 前端骨架与画布引擎（Wave 1）

你是本项目的前端实现代理。唯一契约：`../design.md`（先完整读它）。本文件是你的任务边界。

## 所权（严格）

- 只允许创建/修改：`web/**`
- 禁止触碰：`server/`、`design.md`、`TASKS/`、`logs/`、`README.md`、git 任何操作（PM 负责 commit）
- 后端尚未实现/未启动不是阻塞：api client 按 §3 契约写死，联调用 `GET /api/health` 失败时 UI 显示离线徽章即可，不要 mock 掉真实调用逻辑

## 交付内容

1. Vite + React 18 + TS 脚手架（`web/`，dev 端口 8904，proxy /api→http://localhost:8903）。依赖仅 react/react-dom/vite/@vitejs/plugin-react/typescript/@types/*
2. `src/types.ts` 与 design.md §2 完全一致；`src/api/client.ts` 按 §3 实现全部端点的 fetch 封装（含 502 时抛带 retryable 的错误）
3. 画布引擎 `src/canvas/`：
   - 960x600 逻辑画布（devicePixelRatio 适配），白纸色底，可开关点状参考网格
   - Pointer Events 真实绘制：画笔（圆头线、颜色、1..40px 粗细）、橡皮（composite destination-out）、平滑插值不锯齿
   - 撤销/重做：每笔（pointerup）存 stroke 快照（栈上限 40），redo 栈清空规则正确
   - 清空（二次确认）、导出 dataURL：eval 用 480x300 缩放 PNG；快照用全幅 PNG + 240 宽 JPEG thumb
   - 对外 API（给 Wave 2C 用，写成稳定接口 + 在 web/INTEGRATION.md 里文档化）：getImageForAI() / getFullImage() / applyImage(dataURL)（采纳生成图用）/ onStroke 回调 / strokes 计数 / canUndo/canRedo/事件
4. 状态管理：React context + useReducer 存 ProjectDoc（创建/载入/更新/PUT 保存防抖 800ms + 失败重试 2 次）、阶段切换、round
5. UI 骨架（design.md §7 布局与配色，样式集中在 styles/，自己写 CSS 不引组件库）：
   - 顶栏：项目名+主题/角色/目标 chips+阶段切换器+模式徽章（调 /api/config，mock→「Mock 演示模式」）+Round N+健康徽章
   - 左工具栏：画笔/橡皮/8 色板+自定义 color input/粗细滑条/撤销/重做/清空，当前工具高亮，禁用态正确
   - 中央画布 + 底部状态条（strokes 计数、离线提示）
   - 无项目时：居中创建表单（标题/主题/角色设定/画面目标，必填校验，示例 placeholder 给动画场景），创建成功即进入工作台并建初始空白快照
   - 右侧面板与底部历史条本期放「即将上线」空态占位组件（src/ai/ 与 src/history/ 目录下建占位文件，导出同名组件供 Wave 2C 替换实现，接口在 INTEGRATION.md 定义）
6. `web/INTEGRATION.md`：给 Wave 2C 的集成契约——画布引擎 API、context 形状、占位组件签名、状态条事件
7. `npm run build`（tsc -b && vite build）零错误零警告

## 自验（必须真实跑过）

```
cd web && npm install && npm run build && npm run dev
```
浏览器/或 node 脚本确认 dev 页可载入、无 console 报错（可用 `curl -s localhost:8904 | head` 验证 html 服务）。

## 完成标志

build 零错 + INTEGRATION.md 存在 + 写 `web/SELFREPORT.md`（做了什么、build 输出、偏离项）。
