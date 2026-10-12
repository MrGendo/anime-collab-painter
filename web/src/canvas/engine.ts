// 画布引擎：框架无关的独立类，React 只负责挂载与调用（对外 API 见 web/INTEGRATION.md）
// 双层结构：paint 层存真实笔迹（导出来源），overlay 层画点状网格（绝不进导出）

export const CANVAS_W = 960
export const CANVAS_H = 600
const UNDO_LIMIT = 40 // 契约：撤销栈上限

export type Tool = 'brush' | 'eraser'

export interface StrokePoint { x: number; y: number }

/** 一条可重放的绘制记录：笔迹（矢量）或整幅图片替换（采纳生成图） */
type HistoryEntry =
  | { type: 'stroke'; tool: Tool; color: string; size: number; points: StrokePoint[] }
  | { type: 'image'; el: CanvasImageSource }

export interface CanvasEvents {
  change: void // canUndo/canRedo/strokes 任一变化
}

export class CanvasEngine {
  private container: HTMLElement
  private paint: HTMLCanvasElement
  private overlay: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private base: HTMLCanvasElement // 撤销栈溢出后烘焙进底图，保证重放代价有界
  private undoStack: HistoryEntry[] = []
  private redoStack: HistoryEntry[] = []
  private current: HistoryEntry | null = null
  private dpr = 1

  tool: Tool = 'brush'
  color = '#1B1B1F'
  size = 4
  gridOn = false
  strokes = 0
  private listeners: { change: Array<() => void> } = { change: [] }
  onStroke: ((after: number) => void) | null = null

  constructor(container: HTMLElement) {
    this.container = container
    this.dpr = Math.max(1, window.devicePixelRatio || 1)

    this.paint = document.createElement('canvas')
    this.overlay = document.createElement('canvas')
    this.base = document.createElement('canvas')
    for (const c of [this.paint, this.overlay, this.base]) {
      c.width = CANVAS_W * this.dpr
      c.height = CANVAS_H * this.dpr
    }
    const ctx = this.paint.getContext('2d')
    if (!ctx) throw new Error('无法创建 2D 上下文')
    this.ctx = ctx

    this.paint.className = 'cv-paint'
    this.overlay.className = 'cv-overlay'
    this.container.append(this.paint, this.overlay)

    this.resetBase()
    this.bindPointer()
    this.redraw()
  }

  // ---- 基础 ----
  private resetBase() {
    const b = this.base.getContext('2d')!
    b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    b.fillStyle = '#FDFDFB' // 白纸色
    b.fillRect(0, 0, CANVAS_W, CANVAS_H)
  }

  private toLogical(e: PointerEvent): StrokePoint {
    const r = this.paint.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS_W,
      y: ((e.clientY - r.top) / r.height) * CANVAS_H,
    }
  }

  private bindPointer() {
    const p = this.paint
    p.style.touchAction = 'none' // 防止触摸滚动劫持绘制
    p.addEventListener('pointerdown', this.onDown)
    p.addEventListener('pointermove', this.onMove)
    p.addEventListener('pointerup', this.onUp)
    p.addEventListener('pointercancel', this.onUp)
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    this.paint.setPointerCapture(e.pointerId)
    this.current = { type: 'stroke', tool: this.tool, color: this.color, size: this.size, points: [this.toLogical(e)] }
    this.drawSegment(this.current, null) // 落笔即出点（单点也可见）
  }

  private onMove = (e: PointerEvent) => {
    if (!this.current || this.current.type !== 'stroke') return
    const pts = this.current.points
    const prev = pts[pts.length - 1]
    const next = this.toLogical(e)
    // 同一像素内的 move 丢弃，减少重放数据量
    if (Math.hypot(next.x - prev.x, next.y - prev.y) < 0.8) return
    pts.push(next)
    this.drawSegment(this.current, prev)
  }

  private onUp = () => {
    if (!this.current) return
    this.commit(this.current)
    this.current = null
  }

  /** 增量画最新一段：用中点二次贝塞尔平滑，避免折线锯齿 */
  private drawSegment(entry: Extract<HistoryEntry, { type: 'stroke' }>, prev: StrokePoint | null) {
    const pts = entry.points
    const ctx = this.ctx
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = entry.size
    if (entry.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.strokeStyle = entry.color
    }
    ctx.beginPath()
    if (prev === null || pts.length === 1) {
      // 单点：圆点（橡皮为透明圆孔）
      const p = pts[pts.length - 1]
      ctx.fillStyle = ctx.strokeStyle
      ctx.arc(p.x, p.y, entry.size / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      const cur = pts[pts.length - 1]
      const mid = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 }
      const before = pts[pts.length - 2] ?? prev
      ctx.moveTo((before.x + prev.x) / 2, (before.y + prev.y) / 2)
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 全量重放：底图 + 历史条目（undo/redo/清空后调用） */
  private redraw() {
    const ctx = this.ctx
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.paint.width, this.paint.height)
    ctx.drawImage(this.base, 0, 0)
    ctx.restore()
    for (const entry of this.undoStack) this.replay(entry)
    this.drawGrid()
  }

  private replay(entry: HistoryEntry) {
    if (entry.type === 'image') {
      const ctx = this.ctx
      ctx.save()
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      ctx.drawImage(entry.el, 0, 0, CANVAS_W, CANVAS_H)
      ctx.restore()
      return
    }
    const pts = entry.points
    for (let i = 0; i < pts.length; i++) {
      // 复用增量绘制逻辑逐点重放，保证与实时绘制完全一致
      this.drawSegment({ ...entry, points: pts.slice(0, i + 1) }, i === 0 ? null : pts[i - 1])
    }
  }

  private commit(entry: HistoryEntry) {
    this.undoStack.push(entry)
    if (this.undoStack.length > UNDO_LIMIT) {
      // 溢出烘焙：最旧条目画进 base 后移出撤销范围
      const oldest = this.undoStack.shift()!
      const b = this.base.getContext('2d')!
      b.save()
      b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      if (oldest.type === 'image') b.drawImage(oldest.el, 0, 0, CANVAS_W, CANVAS_H)
      else this.replayOnto(b, oldest)
      b.restore()
    }
    this.redoStack = [] // 新绘制必然清空 redo（契约）
    if (entry.type === 'stroke') this.strokes++
    this.emitChange()
    if (entry.type === 'stroke' && this.onStroke) this.onStroke(this.strokes)
  }

  /** 在任意 2D 上下文上重放一条笔迹（烘焙用） */
  private replayOnto(ctx: CanvasRenderingContext2D, entry: Extract<HistoryEntry, { type: 'stroke' }>) {
    const pts = entry.points
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = entry.size
    if (entry.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.strokeStyle = entry.color
    }
    ctx.beginPath()
    if (pts.length === 1) {
      ctx.fillStyle = ctx.strokeStyle
      ctx.arc(pts[0].x, pts[0].y, entry.size / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    }
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
    ctx.stroke()
  }

  // ---- 点状参考网格（overlay 层，不进导出）----
  setGrid(on: boolean) {
    this.gridOn = on
    this.drawGrid()
  }

  private drawGrid() {
    const ctx = this.overlay.getContext('2d')!
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    if (!this.gridOn) { ctx.restore(); return }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.fillStyle = 'rgba(27,27,31,0.16)'
    const step = 40
    for (let x = step; x < CANVAS_W; x += step) {
      for (let y = step; y < CANVAS_H; y += step) {
        ctx.beginPath()
        ctx.arc(x, y, 1.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  // ---- 撤销 / 重做 / 清空 ----
  get canUndo() { return this.undoStack.length > 0 }
  get canRedo() { return this.redoStack.length > 0 }
  get isEmpty() { return this.strokes === 0 && this.undoStack.every(e => e.type !== 'image') }

  undo(): boolean {
    const entry = this.undoStack.pop()
    if (!entry) return false
    this.redoStack.push(entry)
    if (entry.type === 'stroke') this.strokes = Math.max(0, this.strokes - 1)
    this.redraw()
    this.emitChange()
    return true
  }

  redo(): boolean {
    const entry = this.redoStack.pop()
    if (!entry) return false
    this.undoStack.push(entry) // redo 栈只能来自 undo 弹出，长度必然 ≤ 上限
    if (entry.type === 'stroke') this.strokes++
    this.redraw()
    this.emitChange()
    return true
  }

  clear() {
    this.undoStack = []
    this.redoStack = []
    this.strokes = 0
    this.redraw()
    this.emitChange()
  }

  // ---- 导出 ----
  /** 评估用：480x300 PNG dataURL（等比缩放） */
  getImageForAI(): string {
    return this.exportTo(480, 300, 'image/png')
  }

  /** 快照用：全幅 960x600 PNG dataURL */
  getFullImage(): string {
    return this.exportTo(CANVAS_W, CANVAS_H, 'image/png')
  }

  /** 快照缩略图：240 宽 JPEG（160 高按 2:1.25 等比 = 240x150） */
  getThumb(): string {
    return this.exportTo(240, 150, 'image/jpeg', 0.8)
  }

  private exportTo(w: number, h: number, mime: 'image/png' | 'image/jpeg', quality?: number): string {
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')!
    if (mime === 'image/jpeg') { ctx.fillStyle = '#FDFDFB'; ctx.fillRect(0, 0, w, h) } // JPEG 无 alpha，补白底
    ctx.drawImage(this.paint, 0, 0, w, h)
    return out.toDataURL(mime, quality)
  }

  /** 采纳生成图：整幅替换，但作为可撤销的历史条目（AI 永不无声改画布） */
  applyImage(dataUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        this.commit({ type: 'image', el: img })
        this.redraw()
        resolve()
      }
      img.onerror = () => reject(new Error('生成图载入失败'))
      img.src = dataUrl
    })
  }

  // ---- 事件 ----
  on<K extends keyof CanvasEvents>(kind: K, fn: () => void): void {
    if (kind === 'change') this.listeners.change.push(fn)
  }

  private emitChange() {
    for (const fn of this.listeners.change) fn()
  }

  destroy() {
    this.paint.removeEventListener('pointerdown', this.onDown)
    this.paint.removeEventListener('pointermove', this.onMove)
    this.paint.removeEventListener('pointerup', this.onUp)
    this.paint.removeEventListener('pointercancel', this.onUp)
    this.paint.remove()
    this.overlay.remove()
  }
}
