// Wave 2C 真实现：底部历史条——快照缩略图横滚 + hover 放大 + 大图预览 + 恢复 + 轮次摘要
// 恢复的硬规则：先把当前画布另存为新快照、再载入所选，历史只增不减（design §8）
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../state/AppProvider'
import { useCanvas } from '../canvas/CanvasProvider'
import { useToast } from '../status/ToastProvider'
import { recordRestore, uuid } from '../state/docOps'
import type { Snapshot } from '../types'
import { STAGE_LABEL } from '../ai/labels'

export interface HistoryBarProps {
  /** 当前项目文档；无项目时不会渲染本面板 */
  docId: string | undefined
}

/** hover 放大浮层的锚点信息（跟随缩略图位置） */
interface HoverZoom { snap: Snapshot; x: number; y: number }

/** 快照时间标签（HH:MM） */
function timeTag(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function HistoryBar(_props: HistoryBarProps) {
  const { state, mutateDoc } = useApp()
  const doc = state.doc
  const { engine } = useCanvas()
  const { toast } = useToast()

  const [hover, setHover] = useState<HoverZoom | null>(null)
  const [previewSnap, setPreviewSnap] = useState<Snapshot | null>(null)
  const [restoring, setRestoring] = useState(false)
  const stripRef = useRef<HTMLDivElement | null>(null)

  const snapshots = doc?.snapshots ?? []

  // 新快照到达时自动滚到最右（最新）
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const last = strip.lastElementChild
    last?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' })
  }, [snapshots.length])

  // 预览弹层开着时支持 Esc 关闭
  useEffect(() => {
    if (!previewSnap) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewSnap(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewSnap])

  // 每轮摘要：评估按 round 计数、生成按 generationIds、决策按 decisions
  const roundSummaries = useMemo(() => {
    if (!doc) return []
    return [...doc.rounds]
      .sort((a, b) => a.round - b.round)
      .map(r => ({
        round: r.round,
        stage: r.stage,
        evals: doc.evaluations.filter(e => e.round === r.round).length,
        gens: r.generationIds.length,
        decisions: r.decisions.length,
      }))
  }, [doc])

  function onEnterSnap(s: Snapshot, el: HTMLElement) {
    const r = el.getBoundingClientRect()
    setHover({ snap: s, x: r.left + r.width / 2, y: r.top })
  }

  /** 恢复：二次确认 → 先备份当前画布 → 再载入所选快照 → 记 restore 决策（绝不覆盖历史） */
  async function restore(s: Snapshot): Promise<void> {
    if (!doc || !engine || restoring) return
    if (!window.confirm(`恢复到「${s.label}」？\n当前画布会先自动另存为快照，所有历史都会保留。`)) return
    setRestoring(true)
    try {
      // 必须在 applyImage 之前导出当前画面，否则备份的就是恢复后的内容
      const backup: Snapshot = {
        id: uuid(), round: doc.round, stage: doc.stage,
        image: engine.getFullImage(), thumb: engine.getThumb(),
        createdAt: Date.now(), label: `恢复「${s.label}」前备份`,
      }
      await engine.applyImage(s.image)
      mutateDoc(cur => recordRestore(cur, backup, s.id))
      setPreviewSnap(null)
      setHover(null)
      toast('已恢复到所选快照（恢复前画面已另存）', 'success')
    } catch (err) {
      toast(`恢复失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setRestoring(false)
    }
  }

  if (!doc) return null

  return (
    <footer className="history-bar" data-testid="history-bar">
      <span className="history-label">快照历史</span>

      <div className="snap-strip" ref={stripRef}>
        {snapshots.map(s => (
          <div
            key={s.id}
            className={`snap-item${previewSnap?.id === s.id ? ' active' : ''}`}
            data-testid="snapshot-item"
            title={`${s.label}（R${s.round} · ${STAGE_LABEL[s.stage]} · ${timeTag(s.createdAt)}）`}
            onMouseEnter={e => onEnterSnap(s, e.currentTarget)}
            onMouseLeave={() => setHover(h => (h?.snap.id === s.id ? null : h))}
            onClick={() => setPreviewSnap(s)}
          >
            <img src={s.thumb} alt={s.label} draggable={false} />
            <span className="snap-tag">R{s.round}·{STAGE_LABEL[s.stage]}</span>
          </div>
        ))}
      </div>

      {/* 右侧轮次时间线摘要：每轮 评估/生成/决策 计数 */}
      <div className="rounds-summary" data-testid="rounds-summary">
        {roundSummaries.map(r => (
          <span
            key={r.round}
            className={`round-chip${r.round === doc.round ? ' current' : ''}`}
            title={`Round ${r.round}（${STAGE_LABEL[r.stage]}）：评估 ${r.evals} · 生成 ${r.gens} · 决策 ${r.decisions}`}
          >
            R{r.round} 评{r.evals}·生{r.gens}·决{r.decisions}
          </span>
        ))}
      </div>

      {/* hover 放大浮层：贴着缩略图上方展示全幅图 */}
      {hover && (
        <div className="snap-zoom" style={{ left: hover.x, top: hover.y }}>
          <img src={hover.snap.image} alt={hover.snap.label} />
          <span className="snap-zoom-cap">{hover.snap.label}</span>
        </div>
      )}

      {/* 点击后的大图预览：可关闭，含「恢复到此快照」 */}
      {previewSnap && (
        <div className="modal-backdrop" data-testid="snapshot-preview" onClick={() => setPreviewSnap(null)}>
          <div className="modal preview-modal" onClick={e => e.stopPropagation()}>
            <header className="modal-head">
              {previewSnap.label}
              <span className="panel-sub">R{previewSnap.round} · {STAGE_LABEL[previewSnap.stage]} · {timeTag(previewSnap.createdAt)}</span>
              <button className="hint-close" aria-label="关闭预览" onClick={() => setPreviewSnap(null)}>×</button>
            </header>
            <div className="preview-body">
              <img src={previewSnap.image} alt={previewSnap.label} />
            </div>
            <footer className="modal-foot">
              <button className="btn-danger" data-testid="snapshot-restore" disabled={restoring} onClick={() => void restore(previewSnap)}>
                {restoring ? '恢复中…' : '恢复到此快照'}
              </button>
              <button onClick={() => setPreviewSnap(null)}>关闭</button>
            </footer>
          </div>
        </div>
      )}
    </footer>
  )
}
