# INTEGRATION.md — Wave 2C 集成契约

Wave 1B 冻结的对外接口。替换占位组件时**不要改这些签名**；确需扩展，向后兼容地加字段。

## 1. 画布引擎（`src/canvas/engine.ts` + `CanvasProvider.tsx`）

### 引擎类 `CanvasEngine`（框架无关）

| 成员 | 签名 | 说明 |
|---|---|---|
| getImageForAI | `() => string` | 480x300 PNG dataURL（评估/生成请求的 `image` 字段） |
| getFullImage | `() => string` | 960x600 全幅 PNG dataURL（快照 `image` 字段） |
| getThumb | `() => string` | 240x150 JPEG dataURL q0.8（快照 `thumb` 字段） |
| applyImage | `(dataUrl: string) => Promise<void>` | 采纳生成图：整幅替换、可撤销、触发 change 事件 |
| undo / redo | `() => boolean` | 返回是否实际执行 |
| clear | `() => void` | 清空（调用方负责二次确认） |
| setGrid | `(on: boolean) => void` | 点状参考网格（overlay 层，不进导出） |
| canUndo / canRedo | `boolean` getter | 撤销/重做可用性 |
| strokes | `number` 字段 | 当前画布笔数（undo 递减、clear 归零） |
| isEmpty | `boolean` getter | 无任何内容 |
| tool / color / size | 字段 | `'brush'|'eraser'` / CSS 色 / 1..40 |
| on('change') | `(kind, fn) => void` | canUndo/canRedo/strokes 变化通知 |
| onStroke | 可写回调 | 每笔 pointerup 后收到最新笔数 |

### React 侧 `useCanvas(): CanvasApi`（须在 `CanvasProvider` 内）

```ts
interface CanvasApi {
  engine: CanvasEngine | null            // null = 画布尚未挂载
  mirror: { tool; color; size; grid; canUndo; canRedo; strokes; empty }  // 响应式镜像，change 事件驱动
  register(el: HTMLDivElement): CanvasEngine  // CanvasSurface 已用，勿重复调用
  setTool(t: Tool): void; setColor(c: string): void; setSize(n: number): void
  toggleGrid(): void
  onStrokeDone(cb: (strokes: number) => void): () => void  // 订阅每笔完成，返回退订函数
}
```

典型用法：自动评估提醒条用 `onStrokeDone` 数 25 的倍数；「采纳」按钮 = `engine.applyImage(gen.image)` + 建快照 + Round+1。

## 2. 应用状态（`src/state/AppProvider.tsx`）

```ts
useApp(): {
  state: {
    doc: ProjectDoc | null       // null → 渲染创建表单
    health: 'checking'|'ok'|'offline'   // /api/health 15s 轮询
    config: ConfigInfo | null    // /api/config；null = 后端不可达
    save: 'idle'|'saving'|'saved'|'error'  // error = 已自动重试 2 次仍失败
  }
  createProject(input): Promise<void>   // 成功后 doc 置位并进入工作台
  loadProject(id): Promise<void>
  setStage(stage): void                 // 写 doc.stage，800ms 防抖 PUT
  saveNow(): Promise<boolean>           // 立即落盘（防重入：序列号丢弃过期响应）
}
```

- 保存管线：任何 `doc` 引用变更 → 800ms 防抖 `PUT /api/projects/:id`（payload 的 rev 取自服务端上次返回值）→ 网络类可重试错误自动重试 2 次 → 仍失败 `save='error'` + toast。
- **改 doc 只能走 dispatch/上面这些方法**，不要绕过直接 setState（会破坏防抖与 rev 同步）。
- Wave 2C 追加 evaluations/generations/snapshots/rounds 时：构造新 doc 对象后走一个新增的 action（参照 `patchDoc`），防抖保存自动生效。

## 3. 占位组件（Wave 2C 替换实现，保持默认导出 + props 签名）

| 文件 | 组件 | Props | 职责（Wave 2C） |
|---|---|---|---|
| `src/ai/AIPanel.tsx` | `AIPanel` | `{ docId: string \| undefined }` | 评估区 / 建议列表 / 生成对比三区（design §7） |
| `src/history/HistoryBar.tsx` | `HistoryBar` | `{ docId: string \| undefined }` | 快照缩略图横滚 + 轮次时间线 + 恢复 |
| `src/status/Toast.tsx` | `ToastHost` | `{ items: ToastItem[]; onDismiss(id): void }` | 已可用；异步动作统一走它做 idle/loading/success/error+重试 提示 |

```ts
interface ToastItem { id: number; kind: 'info'|'success'|'error'; text: string; retry?: () => void }
```

`ToastLayer`（App.tsx 内）目前只接保存失败；Wave 2C 把 evaluate/generate 的错误也汇入同一机制即可（建议提升为 context 或轻量 event bus，保持 ToastHost 签名不变）。

## 4. 状态条事件（`src/components/StatusBar.tsx`）

- 展示：`mirror.strokes`、health 在线/离线文案、save 四态。
- Wave 2C 需要新增「可评估提示」：直接读 `useCanvas().mirror.empty`（empty=false → 可评估）。如需自定义事件，在 StatusBar 内 `useCanvas().onStrokeDone(...)` 订阅。

## 5. 请求封装（`src/api/client.ts`）

- 所有端点已按 design §3 实现；失败抛 `ApiError { status, retryable, message }`——502 且 body 带 `retryable:true` 才是可重试；网络层失败视为 `retryable:true`（离线）。
- in-flight 防重入由调用方负责（契约 §3 末条）；建议每类动作一个布尔锁 + 请求序号。

## 6. 样式

- 变量唯一来源 `src/styles/variables.css`（底色 #17181C / 面板 #1F2127 / 强调 #F5A623 / 成功 #35C48D / 高危 #E5484D）。
- 布局骨架 `.app-shell`（grid：topbar/toolbar/canvas+statusbar/ai/history）；占位空态类 `.coming-soon`。
- 禁止引组件库；新样式进 `styles/`，色值只用变量。
