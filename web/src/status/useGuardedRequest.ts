// 每类异步动作一个实例：in-flight 防重入锁 + 请求序号丢弃过期响应（design §8）
// 四态 phase 驱动 UI（idle/loading/success/error），错误信息留在 state 里供横幅+重试使用
import { useCallback, useRef, useState } from 'react'
import { ApiError } from '../api/client'

export type RequestPhase = 'idle' | 'loading' | 'success' | 'error'

export interface GuardedRequest {
  phase: RequestPhase
  /** error 阶段的服务端错误文案 */
  message: string
  /** 502+retryable / 网络层失败为 true */
  retryable: boolean
  /** 执行动作：in-flight 时直接拒绝（返回 false 且不改变既有状态） */
  run: (fn: () => Promise<void>, onError?: (msg: string, retryable: boolean) => void) => Promise<boolean>
  /** 作废在途请求并回到 idle（新评估到来清旧错误等场景） */
  reset: () => void
}

export function useGuardedRequest(): GuardedRequest {
  const [st, setSt] = useState<{ phase: RequestPhase; message: string; retryable: boolean }>({
    phase: 'idle', message: '', retryable: false,
  })
  const busy = useRef(false)
  const seq = useRef(0)

  const run = useCallback(async (
    fn: () => Promise<void>,
    onError?: (msg: string, retryable: boolean) => void,
  ): Promise<boolean> => {
    if (busy.current) return false // 防重入：同类动作在途时忽略重复触发
    busy.current = true
    const my = ++seq.current
    setSt({ phase: 'loading', message: '', retryable: false })
    try {
      await fn()
      if (seq.current !== my) return false // 已被 reset/新一轮作废，丢弃本次响应
      setSt({ phase: 'success', message: '', retryable: false })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const retryable = err instanceof ApiError ? err.retryable : true // 未知异常按可重试处理
      if (seq.current === my) {
        setSt({ phase: 'error', message, retryable })
        onError?.(message, retryable)
      }
      return false
    } finally {
      busy.current = false
    }
  }, [])

  const reset = useCallback(() => {
    seq.current++ // 让在途请求的响应因序号不匹配而被丢弃
    busy.current = false
    setSt({ phase: 'idle', message: '', retryable: false })
  }, [])

  return { ...st, run, reset }
}
