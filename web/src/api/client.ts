// design.md §3 的 fetch 封装：全部 JSON、图片走 dataURL 字符串
import type {
  ProjectDoc, Evaluation, Generation, PromptBuildResult,
  HealthInfo, ConfigInfo, EvaluateMetrics, Region, Scope, Stage,
} from '../types'

/** 带 retryable 标记的错误：502/网络层失败时抛出，供 UI 决定是否可重试 */
export class ApiError extends Error {
  status: number
  retryable: boolean
  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryable = retryable
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (err) {
    // fetch 网络层抛错（后端未启动/断网）→ 视为可重试的离线
    throw new ApiError(`网络请求失败：${err instanceof Error ? err.message : String(err)}`, 0, true)
  }
  const text = await res.text()
  let body: unknown = undefined
  try { body = text ? JSON.parse(text) : undefined } catch { /* 非 JSON 体按原文处理 */ }
  if (!res.ok) {
    const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
      ? (body as { error: string }).error
      : `HTTP ${res.status}`
    // 契约：502 结构化失败带 retryable；其余按不可重试处理
    const retryable = res.status === 502 && !!(body && typeof body === 'object' && (body as { retryable?: unknown }).retryable)
    throw new ApiError(msg, res.status, retryable)
  }
  return body as T
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
}

export const api = {
  health: () => request<HealthInfo>('/api/health'),
  config: () => request<ConfigInfo>('/api/config'),
  createProject: (input: { title: string; theme: string; character: string; goal: string }) =>
    post<{ doc: ProjectDoc }>('/api/projects', input),
  getProject: (id: string) => request<{ doc: ProjectDoc }>(`/api/projects/${encodeURIComponent(id)}`),
  saveProject: (id: string, doc: ProjectDoc) =>
    request<{ doc: ProjectDoc }>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc }),
    }),
  evaluate: (input: { projectId: string; round: number; stage: Stage; image: string; metrics: EvaluateMetrics }) =>
    post<{ evaluation: Evaluation }>('/api/evaluate', input),
  buildPrompt: (input: { projectId: string; suggestionId?: string; scope: Scope; stage: Stage; basePrompt: string; image: string }) =>
    post<PromptBuildResult>('/api/prompt/build', input),
  generate: (input: { projectId: string; round: number; suggestionId?: string; scope: Scope; prompt: string; image: string; region?: Region; simulateFail?: boolean }) =>
    post<{ generation: Generation }>('/api/generate', input),
}
