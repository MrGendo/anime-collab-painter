// 全局状态：ProjectDoc 生命周期 + 顶栏徽章所需的后端探测信息
import type { ProjectDoc, ConfigInfo, Stage } from '../types'

export type HealthState = 'checking' | 'ok' | 'offline'
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface AppState {
  doc: ProjectDoc | null
  health: HealthState
  config: ConfigInfo | null
  save: SaveState
}

export type AppAction =
  | { type: 'docLoaded'; doc: ProjectDoc }
  | { type: 'docCleared' }
  | { type: 'patchDoc'; patch: Partial<ProjectDoc> }
  // Wave 2C：调用方用纯函数构造新 doc 后整体替换（evaluations/generations/snapshots/rounds 写入）
  | { type: 'docUpdated'; doc: ProjectDoc }
  | { type: 'setStage'; stage: Stage }
  | { type: 'setHealth'; health: HealthState }
  | { type: 'setConfig'; config: ConfigInfo | null }
  | { type: 'setSave'; save: SaveState }

export const initialAppState: AppState = {
  doc: null,
  health: 'checking',
  config: null,
  save: 'idle',
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'docLoaded':
      return { ...state, doc: action.doc }
    case 'docCleared':
      return { ...state, doc: null, save: 'idle' }
    case 'patchDoc':
      return state.doc ? { ...state, doc: { ...state.doc, ...action.patch } } : state
    case 'docUpdated':
      return { ...state, doc: action.doc }
    case 'setStage':
      // 切阶段属于文档变更，走统一防抖保存
      return state.doc ? { ...state, doc: { ...state.doc, stage: action.stage } } : state
    case 'setHealth':
      return { ...state, health: action.health }
    case 'setConfig':
      return { ...state, config: action.config }
    case 'setSave':
      return { ...state, save: action.save }
  }
}
