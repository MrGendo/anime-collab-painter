// Context Provider：持有 AppState，负责 health 轮询 / config 载入 / PUT 防抖保存（800ms + 失败重试 2 次）
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { api, ApiError } from '../api/client'
import type { ProjectDoc, Stage } from '../types'
import { appReducer, initialAppState, type AppState } from './appState'

export interface AppApi {
  state: AppState
  createProject: (input: { title: string; theme: string; character: string; goal: string }) => Promise<void>
  loadProject: (id: string) => Promise<void>
  setStage: (stage: Stage) => void
  saveNow: () => Promise<boolean>
  /** Wave 2C 追加：以纯函数原子改写 doc（评估/生成/快照/决策），改完自动走防抖保存 */
  mutateDoc: (fn: (doc: ProjectDoc) => ProjectDoc) => void
}

const AppContext = createContext<AppApi | null>(null)

export function useApp(): AppApi {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必须在 AppProvider 内使用')
  return ctx
}

const SAVE_DEBOUNCE_MS = 800
const SAVE_RETRY = 2
const HEALTH_POLL_MS = 15000

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState)

  // 保存序列号：过期响应直接丢弃（契约 §8 防乱序）
  const saveSeq = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 已落盘的 doc 引用：载入/保存回写本身不再触发下一轮保存
  const savedRef = useRef<ProjectDoc | null>(null)
  // 服务端返回的最新 rev：只在发送时合入 payload，避免改 doc 引用引发保存循环
  const serverRev = useRef(0)

  const doc = state.doc
  // 始终指向最新 doc 的 ref：让 mutateDoc 拿到的基线永不过期（防止旧闭包覆盖新写入）
  const docRef = useRef<ProjectDoc | null>(null)
  docRef.current = doc

  // Wave 2C：稳定引用的原子改写入口，配合 docOps 纯函数使用
  const mutateDoc = useCallback((fn: (d: ProjectDoc) => ProjectDoc) => {
    const cur = docRef.current
    if (cur) dispatch({ type: 'docUpdated', doc: fn(cur) })
  }, [])

  // ---- 真实保存：失败自动重试 2 次（可重试类错误），仍失败置 error ----
  async function flush(docToSave: ProjectDoc, seq: number): Promise<boolean> {
    dispatch({ type: 'setSave', save: 'saving' })
    for (let attempt = 0; attempt <= SAVE_RETRY; attempt++) {
      try {
        const { doc: saved } = await api.saveProject(docToSave.meta.id, { ...docToSave, rev: serverRev.current })
        if (saveSeq.current !== seq) return false // 已有更新一轮保存，本次结果作废
        savedRef.current = docToSave
        serverRev.current = saved.rev
        dispatch({ type: 'setSave', save: 'saved' })
        return true
      } catch (err) {
        if (saveSeq.current !== seq) return false
        const retryable = err instanceof ApiError && err.retryable
        if (!retryable || attempt === SAVE_RETRY) break
        await new Promise(r => setTimeout(r, 400 * (attempt + 1))) // 退避后重试
      }
    }
    dispatch({ type: 'setSave', save: 'error' })
    return false
  }

  // ---- 防抖保存：doc 引用变化后 800ms 落盘 ----
  useEffect(() => {
    if (!doc || savedRef.current === doc) return
    if (timer.current) clearTimeout(timer.current)
    const seq = ++saveSeq.current
    timer.current = setTimeout(() => { void flush(doc, seq) }, SAVE_DEBOUNCE_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [doc])

  // ---- health 轮询 + config 载入（失败即离线徽章，绝不 mock 真实调用）----
  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        await api.health()
        if (alive) dispatch({ type: 'setHealth', health: 'ok' })
      } catch {
        if (alive) dispatch({ type: 'setHealth', health: 'offline' })
      }
    }
    void poll()
    const iv = setInterval(poll, HEALTH_POLL_MS)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  // ---- 启动恢复：刷新不丢当前项目（localStorage 记 id；404/离线则清掉回创建表单）----
  useEffect(() => {
    const lastId = localStorage.getItem('tib.currentProject')
    if (!lastId) return
    let alive = true
    api.getProject(lastId)
      .then(({ doc }) => { if (alive) { savedRef.current = doc; serverRev.current = doc.rev; dispatch({ type: 'docLoaded', doc }) } })
      .catch(() => { if (alive) localStorage.removeItem('tib.currentProject') })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    api.config().then(c => { if (alive) dispatch({ type: 'setConfig', config: c }) })
      .catch(() => { if (alive) dispatch({ type: 'setConfig', config: null }) })
    return () => { alive = false }
  }, [])

  const apiObj = useMemo<AppApi>(() => ({
    state,
    async createProject(input) {
      const { doc: created } = await api.createProject(input)
      savedRef.current = created
      serverRev.current = created.rev
      localStorage.setItem('tib.currentProject', created.meta.id)
      dispatch({ type: 'docLoaded', doc: created })
    },
    async loadProject(id) {
      const { doc: loaded } = await api.getProject(id)
      savedRef.current = loaded
      serverRev.current = loaded.rev
      dispatch({ type: 'docLoaded', doc: loaded })
    },
    setStage(stage) { dispatch({ type: 'setStage', stage }) },
    async saveNow() {
      if (!state.doc) return false
      if (timer.current) clearTimeout(timer.current)
      const seq = ++saveSeq.current
      return flush(state.doc, seq)
    },
    mutateDoc,
  }), [state, mutateDoc])

  return <AppContext.Provider value={apiObj}>{children}</AppContext.Provider>
}
