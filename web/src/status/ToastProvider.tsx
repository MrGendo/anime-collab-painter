// 统一 toast 上下文：success/error/info 自动消失、可叠放（超限丢最旧）、error 可带重试
// ToastHost 组件签名冻结（INTEGRATION §3），本层只负责 items 的生命周期管理
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import ToastHost, { type ToastItem } from './Toast'

interface ToastOptions {
  retry?: () => void
  /** 覆盖默认自动消失时长 */
  durationMs?: number
}

interface ToastApi {
  toast: (text: string, kind?: ToastItem['kind'], opts?: ToastOptions) => void
  dismiss: (id: number) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}

const MAX_STACK = 5          // 叠放上限，超出丢最旧，避免长会话堆积
const DEFAULT_MS = 4000      // info/success 停留时长
const ERROR_MS = 8000        // 错误（尤其带重试）多留一会儿

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    setItems(prev => prev.filter(x => x.id !== id))
  }, [])

  const toast = useCallback((text: string, kind: ToastItem['kind'] = 'info', opts?: ToastOptions) => {
    const id = nextId.current++
    setItems(prev => {
      const next = [...prev, { id, kind, text, retry: opts?.retry }]
      return next.length > MAX_STACK ? next.slice(next.length - MAX_STACK) : next
    })
    const ms = opts?.durationMs ?? (kind === 'error' ? ERROR_MS : DEFAULT_MS)
    timers.current.set(id, setTimeout(() => dismiss(id), ms))
  }, [dismiss])

  // 卸载时清掉全部定时器，防止泄漏
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t) }, [])

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastHost items={items} onDismiss={dismiss} />
    </ToastCtx.Provider>
  )
}
