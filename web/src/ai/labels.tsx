// AI 面板用的中文标签映射与「实测数字」高亮工具
import type { ReactNode } from 'react'
import type { IssueKind, Scope, Severity, Stage } from '../types'

export const STAGE_LABEL: Record<Stage, string> = { sketch: '草稿', lineart: '线稿', color: '上色', detail: '细化' }

export const SCOPE_LABEL: Record<Scope, string> = {
  pose: '姿态', contour: '轮廓', color: '色彩', background: '背景', local: '局部', global: '全局',
}

export const KIND_LABEL: Record<IssueKind, string> = {
  composition: '构图', consistency: '一致性', pose: '姿态', contour: '轮廓', color: '色彩', background: '背景', goal: '目标',
}

/** kind 图标（几何字形，避免emoji干扰阅读） */
export const KIND_ICON: Record<IssueKind, string> = {
  composition: '▦', consistency: '⧉', pose: '⚑', contour: '✎', color: '◐', background: '▤', goal: '◎',
}

export const SEVERITY_LABEL: Record<Severity, string> = { high: '高', medium: '中', low: '低' }

/** severity → 语义色类名（对应 variables.css 的 danger/accent/text-dim） */
export function severityClass(s: Severity): string {
  return s === 'high' ? 'sev-high' : s === 'medium' ? 'sev-medium' : 'sev-low'
}

export const ALL_SCOPES: Scope[] = ['pose', 'contour', 'color', 'background', 'local', 'global']

/**
 * 实测数字高亮：把文本里的数字片段（含 %/px/° 后缀）包成高亮 span，
 * 让「内容 78% 集中在左侧 1/3」这类实测结论一眼可见（契约 §10 可追溯性）
 */
export function highlightNumbers(text: string): ReactNode[] {
  return text
    .split(/(\d+(?:\.\d+)?(?:%|px|°)?)/g)
    .map((part, i) => (/^\d/.test(part) ? <span key={i} className="num-hl">{part}</span> : part))
}
