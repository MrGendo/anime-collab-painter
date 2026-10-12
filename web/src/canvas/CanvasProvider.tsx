// 画布引擎的 React 绑定：CanvasSurface 挂载真实 DOM，其余组件通过 useCanvas() 拿引擎与镜像状态
// 对 Wave 2C 的稳定接口见 web/INTEGRATION.md
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CanvasEngine, type Tool } from './engine'
import { useApp } from '../state/AppProvider'

export interface CanvasMirror {
  tool: Tool
  color: string
  size: number
  grid: boolean
  canUndo: boolean
  canRedo: boolean
  strokes: number
  empty: boolean
}

export interface CanvasApi {
  engine: CanvasEngine | null
  mirror: CanvasMirror
  /** CanvasSurface 专用：把引擎挂到真实 DOM 上 */
  register: (el: HTMLDivElement) => CanvasEngine
  setTool: (t: Tool) => void
  setColor: (c: string) => void
  setSize: (n: number) => void
  toggleGrid: () => void
  /** 订阅「一笔完成」事件，返回退订函数（Wave 2C 用它做每 25 笔提醒） */
  onStrokeDone: (cb: (strokes: number) => void) => () => void
}

const CanvasCtx = createContext<CanvasApi | null>(null)

export function useCanvas(): CanvasApi {
  const ctx = useContext(CanvasCtx)
  if (!ctx) throw new Error('useCanvas 必须在 CanvasProvider 内使用')
  return ctx
}

export function CanvasProvider({ children }: { children: React.ReactNode }) {
  const [engine, setEngine] = useState<CanvasEngine | null>(null)
  const [mirror, setMirror] = useState<CanvasMirror>({
    tool: 'brush', color: '#1B1B1F', size: 4, grid: false,
    canUndo: false, canRedo: false, strokes: 0, empty: true,
  })
  const strokeCbs = useRef(new Set<(n: number) => void>())

  const sync = useCallback((e: CanvasEngine) => {
    setMirror({
      tool: e.tool, color: e.color, size: e.size, grid: e.gridOn,
      canUndo: e.canUndo, canRedo: e.canRedo, strokes: e.strokes, empty: e.isEmpty,
    })
  }, [])

  const register = useCallback((el: HTMLDivElement) => {
    const eng = new CanvasEngine(el)
    eng.on('change', () => sync(eng))
    eng.onStroke = (n) => { for (const cb of strokeCbs.current) cb(n) }
    setEngine(eng)
    sync(eng)
    return eng
  }, [sync])

  const api: CanvasApi = {
    engine,
    mirror,
    register,
    setTool: (t) => { if (engine) { engine.tool = t; sync(engine) } },
    setColor: (c) => { if (engine) { engine.color = c; sync(engine) } },
    setSize: (n) => { if (engine) { engine.size = n; sync(engine) } },
    toggleGrid: () => { if (engine) { engine.setGrid(!engine.gridOn); sync(engine) } },
    onStrokeDone: (cb) => {
      strokeCbs.current.add(cb)
      return () => { strokeCbs.current.delete(cb) }
    },
  }

  return <CanvasCtx.Provider value={api}>{children}</CanvasCtx.Provider>
}

/** 中央画布挂载点：渲染在工作台布局中间，负责创建/销毁引擎 */
export function CanvasSurface() {
  const { register, engine } = useCanvas()
  const { state } = useApp()
  const doc = state.doc
  const restoredFor = useRef<string | null>(null)
  const divRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!divRef.current) return
    const eng = register(divRef.current)
    return () => eng.destroy() // StrictMode 双挂载 / 卸载时清理
  }, [register])

  // 刷新恢复：doc 载入 + 引擎就绪 + 画布仍为空 → 静默应用最新快照（不新增历史，strokes 归零由引擎定义）
  useEffect(() => {
    if (!doc || !engine) return
    if (restoredFor.current === doc.meta.id) return
    if (!engine.isEmpty) { restoredFor.current = doc.meta.id; return }
    const latest = doc.snapshots.length ? doc.snapshots[doc.snapshots.length - 1] : null
    if (!latest) { restoredFor.current = doc.meta.id; return }
    restoredFor.current = doc.meta.id
    void engine.applyImage(latest.image).catch(() => {})
  }, [doc, engine])

  return <div ref={divRef} className="canvas-host" />
}
