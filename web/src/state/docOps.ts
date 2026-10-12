// Wave 2C：doc 写入的纯函数助手（evaluations/generations/snapshots/rounds/decisions）
// 全部返回新对象、绝不原地修改；由 AppProvider.mutateDoc 原子应用后走防抖保存（INTEGRATION §2）
import type {
  Evaluation, Generation, ProjectDoc, RoundRecord, Snapshot, Stage,
} from '../types'

/** 全幅快照保留上限（design §2）：超出淘汰最旧；最新一条代表"当前"，永不被淘汰 */
const MAX_SNAPSHOTS = 30

/** 浏览器端 id：优先 crypto.randomUUID（localhost 属安全上下文），退化到时间戳+随机后缀 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export type Decision = RoundRecord['decisions'][number]

/** 追加快照并执行 30 条上限淘汰 */
export function appendSnapshot(snaps: Snapshot[], snap: Snapshot): Snapshot[] {
  const next = [...snaps, snap]
  while (next.length > MAX_SNAPSHOTS) next.shift()
  return next
}

/**
 * 在 doc 上定位/创建某轮记录并施加变更（与服务端 upsertRound 同构）：
 * 找不到则新建、始终刷新该轮 stage、按轮次升序，返回全新 doc
 */
function withRound(
  doc: ProjectDoc, round: number, stage: Stage, mutate?: (r: RoundRecord) => void,
): ProjectDoc {
  const rounds = doc.rounds.map(r => ({ ...r, generationIds: [...r.generationIds], decisions: [...r.decisions] }))
  let rec = rounds.find(r => r.round === round)
  if (!rec) { rec = { round, stage, generationIds: [], decisions: [] }; rounds.push(rec) }
  rec.stage = stage
  mutate?.(rec)
  rounds.sort((a, b) => a.round - b.round)
  return { ...doc, rounds }
}

/** 评估结果落 doc：evaluations 追加 + 所属轮记录 evaluationId */
export function appendEvaluation(doc: ProjectDoc, ev: Evaluation): ProjectDoc {
  return withRound({ ...doc, evaluations: [...doc.evaluations, ev] }, ev.round, ev.stage, r => { r.evaluationId = ev.id })
}

/** 生成结果落 doc：generations 追加 + 所属轮 generationIds 追加 */
export function appendGeneration(doc: ProjectDoc, gen: Generation): ProjectDoc {
  return withRound({ ...doc, generations: [...doc.generations, gen] }, gen.round, doc.stage, r => { r.generationIds.push(gen.id) })
}

/** 在当前轮记录一条决策（accept/reject/adjust/adopt/restore） */
export function recordDecision(doc: ProjectDoc, decision: Decision): ProjectDoc {
  return withRound(doc, doc.round, doc.stage, r => { r.decisions.push(decision) })
}

/**
 * 采纳生成图：round+1、旧轮记录 adopt 决策、新轮记录就位、写入采纳后画布快照。
 * 调用前必须先 engine.applyImage 并导出快照图，保证快照与画布一致。
 */
export function adoptGeneration(doc: ProjectDoc, gen: Generation, snap: Snapshot): ProjectDoc {
  const nextRound = doc.round + 1
  let next = withRound(doc, doc.round, doc.stage, r => {
    r.decisions.push({ type: 'adopt', targetId: gen.id, note: gen.scope, at: snap.createdAt })
  })
  next = withRound(next, nextRound, doc.stage)
  return { ...next, round: nextRound, snapshots: appendSnapshot(next.snapshots, snap) }
}

/** 恢复快照：当前画面备份为新快照 + 当前轮记录 restore 决策（历史只增不减） */
export function recordRestore(doc: ProjectDoc, backup: Snapshot, targetId: string): ProjectDoc {
  const next = recordDecision(doc, { type: 'restore', targetId, note: backup.label, at: backup.createdAt })
  return { ...next, snapshots: appendSnapshot(next.snapshots, backup) }
}

export interface SuggestionDecision {
  status: 'accepted' | 'rejected'
  /** adjust 决策保存的编辑稿，生成时优先于原始 promptDraft 使用 */
  promptOverride?: string
  at: number
}

/**
 * 从 doc.rounds 反推每条建议的最新决策（后写的覆盖先写的），
 * reload 后建议列表的「已接受/已拒绝/调整稿」状态可完整还原。
 * adopt/restore 的 targetId 是生成图/快照 id，与建议 id（UUID）无碰撞，忽略。
 */
export function deriveSuggestionDecisions(doc: ProjectDoc): Map<string, SuggestionDecision> {
  const map = new Map<string, SuggestionDecision>()
  const rounds = [...doc.rounds].sort((a, b) => a.round - b.round)
  for (const r of rounds) {
    for (const d of r.decisions) {
      if (d.type === 'accept') map.set(d.targetId, { status: 'accepted', at: d.at })
      else if (d.type === 'adjust') map.set(d.targetId, { status: 'accepted', promptOverride: d.note, at: d.at })
      else if (d.type === 'reject') map.set(d.targetId, { status: 'rejected', at: d.at })
    }
  }
  return map
}
