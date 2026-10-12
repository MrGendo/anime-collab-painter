// Wave 2C 真实现：右侧 AI 协作面板——① 评估 ② 建议决策 ③ 生成与对比（design.md §7）
// 硬规则：AI 永不直接改画布，只有用户点「采纳」才 applyImage + 快照 + Round+1；
// 所有异步动作四态可视、in-flight 禁用、失败可重试；自动评估只提示、人工确认才发
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import { useApp } from '../state/AppProvider'
import { useCanvas } from '../canvas/CanvasProvider'
import { useToast } from '../status/ToastProvider'
import { useGuardedRequest } from '../status/useGuardedRequest'
import {
  adoptGeneration, appendEvaluation, appendGeneration, deriveSuggestionDecisions,
  recordDecision, uuid, type Decision, type SuggestionDecision,
} from '../state/docOps'
import type { Generation, Region, Scope, Severity, Snapshot, Stage, Suggestion } from '../types'
import RegionOverlay from './RegionOverlay'
import {
  ALL_SCOPES, KIND_ICON, KIND_LABEL, SCOPE_LABEL, SEVERITY_LABEL, STAGE_LABEL,
  highlightNumbers, severityClass,
} from './labels'

export interface AIPanelProps {
  /** 当前项目文档；无项目时不会渲染本面板 */
  docId: string | undefined
}

/** hover 的区域高亮（建议/问题条目悬停时） */
interface HoverTarget { region: Region; severity: Severity }

/** 自动评估提示来源：切阶段 / 每 25 笔（人工确认才执行，绝不自动发） */
type EvalHint = { reason: 'stage'; stage: Stage } | { reason: 'strokes'; strokes: number } | null

/** 各阶段的评估侧重提示（对应服务端 prompts.ts 的阶段×模板组合） */
const STAGE_TIP: Record<Stage, string> = {
  sketch: '草稿阶段侧重构图与目标一致性',
  lineart: '线稿阶段侧重构图 · 一致性 · 轮廓',
  color: '上色阶段侧重一致性与色彩关系',
  detail: '细化阶段全维度评估',
}

export default function AIPanel({ docId }: AIPanelProps) {
  const { state, mutateDoc } = useApp()
  const doc = state.doc
  const { engine, mirror, onStrokeDone } = useCanvas()
  const { toast } = useToast()

  // 三类动作各自独立的防重入锁 + 序号（评估 / 生成 / 模板特调）
  const evalReq = useGuardedRequest()
  const genReq = useGuardedRequest()
  const tplReq = useGuardedRequest()

  // ---- 面板局部 UI 状态 ----
  const [hint, setHint] = useState<EvalHint>(null)
  const [hover, setHover] = useState<HoverTarget | null>(null)
  const [selectedSuggId, setSelectedSuggId] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<{ id: string; text: string } | null>(null)
  const [genSourceId, setGenSourceId] = useState<string | 'manual' | null>(null)
  const [promptText, setPromptText] = useState('')
  const [scope, setScope] = useState<Scope>('global')
  const [simulateFail, setSimulateFail] = useState(false)
  const [compare, setCompare] = useState<{ original: string; generation: Generation } | null>(null)
  const [adopting, setAdopting] = useState(false)

  // 会话起点（评估 metrics.sessionMs 用）；ref 镜像最新 doc，防止 await 后闭包过期
  const sessionStart = useMemo(() => Date.now(), [])
  const docRef = useRef(doc)
  docRef.current = doc
  // toast 重试按钮是延迟回调，经 ref 永远调到最新一次渲染的动作函数
  const retryRef = useRef({ evaluate: () => {}, generate: () => {} })

  // ---- 派生数据 ----
  const latestEval = doc && doc.evaluations.length > 0 ? doc.evaluations[doc.evaluations.length - 1] : null
  const suggestions = latestEval?.suggestions ?? []
  const decisions = useMemo(
    () => (doc ? deriveSuggestionDecisions(doc) : new Map<string, SuggestionDecision>()),
    [doc],
  )
  const queue = suggestions.filter(s => decisions.get(s.id)?.status === 'accepted')
  const selectedSugg = selectedSuggId ? suggestions.find(s => s.id === selectedSuggId) ?? null : null
  const activeRegion = selectedSugg?.region ?? hover?.region ?? null
  const activeSeverity = selectedSugg?.severity ?? hover?.severity

  // ---- 自动评估提示：阶段切换触发（首次载入不算）----
  const prevStage = useRef<Stage | null>(null)
  useEffect(() => {
    const stage = doc?.stage
    if (!stage) return
    if (prevStage.current != null && prevStage.current !== stage) setHint({ reason: 'stage', stage })
    prevStage.current = stage
  }, [doc?.stage])

  // ---- 自动评估提示：每 25 笔触发（同一里程碑只提示一次）----
  const milestone = useRef(0)
  useEffect(() => onStrokeDone(n => {
    if (n > 0 && n % 25 === 0 && n !== milestone.current) {
      milestone.current = n
      setHint({ reason: 'strokes', strokes: n })
    }
  }), [onStrokeDone])

  // ---- 动作 ----
  async function runEvaluate(): Promise<void> {
    const d = docRef.current
    if (!d || !engine || evalReq.phase === 'loading') return
    const image = engine.getImageForAI()
    await evalReq.run(async () => {
      const { evaluation } = await api.evaluate({
        projectId: d.meta.id,
        round: d.round,
        stage: d.stage,
        image,
        metrics: { strokes: engine.strokes, sessionMs: Date.now() - sessionStart },
      })
      mutateDoc(cur => appendEvaluation(cur, evaluation))
      setHint(null)
      toast('评估完成', 'success')
    }, msg => toast(`评估失败：${msg}`, 'error', { retry: () => retryRef.current.evaluate() }))
  }

  function decide(s: Suggestion, type: 'accept' | 'reject'): void {
    // 显式按字面量分支构造，保证匹配 Decision 联合的单一成员（联合类型不能直接接受宽化的 type）
    const decision: Decision = type === 'accept'
      ? { type: 'accept', targetId: s.id, at: Date.now() }
      : { type: 'reject', targetId: s.id, at: Date.now() }
    mutateDoc(cur => recordDecision(cur, decision))
    toast(type === 'accept' ? '已接受，进入待生成队列' : '已拒绝该建议', 'info')
  }

  function saveAdjust(): void {
    if (!adjusting) return
    const s = suggestions.find(x => x.id === adjusting.id)
    if (!s) { setAdjusting(null); return }
    mutateDoc(cur => recordDecision(cur, {
      type: 'adjust', targetId: s.id,
      note: adjusting.text.trim() || s.promptDraft, // 空稿回落原始草稿，保证生成始终有提示词
      at: Date.now(),
    }))
    setAdjusting(null)
    toast('已保存调整稿，进入待生成队列', 'info')
  }

  /** 选定生成对象：已接受建议（自动填入草稿/调整稿并锁定其 scope）或手动模式 */
  function pickSource(id: string | 'manual'): void {
    setGenSourceId(id)
    if (id === 'manual') return
    const s = suggestions.find(x => x.id === id)
    if (s) {
      setPromptText(decisions.get(s.id)?.promptOverride ?? s.promptDraft)
      setScope(s.scope)
      setSelectedSuggId(id) // 顺带 pin 该建议的 region 高亮
    }
  }

  async function applyTemplate(): Promise<void> {
    const d = docRef.current
    if (!d || !engine || tplReq.phase === 'loading') return
    const src = genSourceId && genSourceId !== 'manual' ? suggestions.find(s => s.id === genSourceId) : undefined
    await tplReq.run(async () => {
      const r = await api.buildPrompt({
        projectId: d.meta.id,
        suggestionId: src?.id,
        scope,
        stage: d.stage,
        basePrompt: promptText,
        image: engine.getImageForAI(),
      })
      setPromptText(r.finalPrompt) // 返回内容仅用于展示/编辑；编辑后的文本才是发送内容（§6）
      toast(`已套用模板 ${r.templateName}`, 'info')
    }, msg => toast(`模板构建失败：${msg}`, 'error'))
  }

  async function runGenerate(): Promise<void> {
    const d = docRef.current
    if (!d || !engine || genReq.phase === 'loading') return
    const prompt = promptText.trim()
    if (!prompt) { toast('请先填写生成提示词（可套用服务端模板）', 'info'); return }
    const src = genSourceId && genSourceId !== 'manual' ? suggestions.find(s => s.id === genSourceId) : undefined
    const image = engine.getImageForAI() // 同一份图兼作对比视图的「原画布」
    await genReq.run(async () => {
      const { generation } = await api.generate({
        projectId: d.meta.id,
        round: d.round,
        suggestionId: src?.id,
        scope,
        prompt,
        image,
        region: src?.region,
        simulateFail: simulateFail || undefined,
      })
      mutateDoc(cur => appendGeneration(cur, generation))
      setCompare({ original: image, generation })
      toast('修正版已生成，请对比后决策', 'success')
    }, msg => toast(`生成失败：${msg}`, 'error', { retry: () => retryRef.current.generate() }))
  }

  /** 采纳：画上生成图 → 自动快照（全幅+thumb）→ Round+1 → 记 adopt 决策 → 防抖 PUT → toast */
  async function adopt(): Promise<void> {
    const d0 = docRef.current
    if (!d0 || !engine || !compare || adopting) return
    setAdopting(true)
    try {
      await engine.applyImage(compare.generation.image)
      const d = docRef.current ?? d0
      const nextRound = d.round + 1
      const snap: Snapshot = {
        id: uuid(), round: nextRound, stage: d.stage,
        image: engine.getFullImage(), thumb: engine.getThumb(),
        createdAt: Date.now(), label: `采纳${SCOPE_LABEL[compare.generation.scope]}修正`,
      }
      mutateDoc(cur => adoptGeneration(cur, compare.generation, snap))
      setCompare(null)
      toast(`已采纳修正版，进入 Round ${nextRound}`, 'success')
    } catch (err) {
      toast(`采纳失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setAdopting(false)
    }
  }

  retryRef.current = { evaluate: () => void runEvaluate(), generate: () => void runGenerate() }

  if (!docId || !doc) return null

  const hintText = hint?.reason === 'stage'
    ? `阶段已切换到「${STAGE_LABEL[hint.stage]}」——建议在此节点请求 AI 评估`
    : hint ? `已绘制 ${hint.strokes} 笔——建议在此节点请求 AI 评估` : ''
  const scoreClass = latestEval
    ? latestEval.overall.score >= 75 ? 'good' : latestEval.overall.score >= 50 ? 'mid' : 'bad'
    : 'bad'
  const manualActive = genSourceId === null || genSourceId === 'manual'

  return (
    <aside className="panel ai-panel" data-testid="ai-panel">
      <div className="panel-title">
        AI 协作面板
        <span className="panel-sub">Round {doc.round} · {STAGE_LABEL[doc.stage]}</span>
      </div>

      {/* 自动评估呼吸灯提示条：只提示，一键人工确认才真正发评估 */}
      {hint && (
        <div className="hint-bar" data-testid="eval-hint-bar">
          <i className="hint-pulse" />
          <span className="hint-text">{hintText}</span>
          <button
            data-testid="hint-eval-now"
            onClick={() => void runEvaluate()}
            disabled={evalReq.phase === 'loading' || mirror.empty}
          >
            立即评估
          </button>
          <button className="hint-close" aria-label="关闭提示" onClick={() => setHint(null)}>×</button>
        </div>
      )}

      {/* ① 评估区 */}
      <section className="ai-section" data-testid="eval-section">
        <h3>① 评估</h3>
        <p className="stage-tip">{STAGE_TIP[doc.stage]}</p>
        <button
          className="btn-primary wide"
          data-testid="eval-trigger"
          onClick={() => void runEvaluate()}
          disabled={evalReq.phase === 'loading' || mirror.empty || !engine}
          title={mirror.empty ? '画布为空：先绘制几笔再评估' : '发送画布快照与笔画数给 AI 评估'}
        >
          {evalReq.phase === 'loading' ? <><span className="spinner" />评估中…</> : '请求 AI 评估'}
        </button>
        {!latestEval && evalReq.phase !== 'loading' && (
          <p className="dim-note">还没有评估记录——先绘制几笔，AI 会基于实测像素数据给反馈。</p>
        )}
        {mirror.empty && <p className="dim-note">画布为空：评估需要实际笔迹作依据。</p>}
        {evalReq.phase === 'error' && (
          <div className="error-banner" data-testid="eval-error">
            <span>评估失败：{evalReq.message}</span>
            <button onClick={() => void runEvaluate()}>重试</button>
          </div>
        )}

        {latestEval && (
          <div className="eval-result" data-testid="eval-result">
            <div className="eval-meta">
              Round {latestEval.round} · {STAGE_LABEL[latestEval.stage]} · {latestEval.provider}({latestEval.mode}) · {latestEval.latencyMs}ms
            </div>
            <div className="score-row">
              <span className={`score-num ${scoreClass}`}>{latestEval.overall.score}</span>
              <div className="score-bar"><div className={`score-fill ${scoreClass}`} style={{ width: `${latestEval.overall.score}%` }} /></div>
            </div>
            <p className="eval-summary">{latestEval.overall.summary}</p>
            {latestEval.strengths.length > 0 && (
              <ul className="strength-list">
                {latestEval.strengths.map((t, i) => <li key={i}>✓ {highlightNumbers(t)}</li>)}
              </ul>
            )}
            {latestEval.issues.length > 0 && (
              <div className="issue-list">
                {latestEval.issues.map(is => (
                  <div
                    key={is.id}
                    className="issue-item"
                    onMouseEnter={() => setHover(is.region ? { region: is.region, severity: is.severity } : null)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <span className={`sev-badge ${severityClass(is.severity)}`}>{SEVERITY_LABEL[is.severity]}</span>
                    <span className="kind-chip">{KIND_ICON[is.kind]} {KIND_LABEL[is.kind]}</span>
                    <span className="issue-title">{is.title}</span>
                    {is.detail && <span className="issue-detail">{highlightNumbers(is.detail)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ② 建议列表 */}
      <section className="ai-section" data-testid="suggestion-section">
        <h3>② 建议 <span className="panel-sub">{suggestions.length > 0 ? `${suggestions.length} 条 · 接受后进入待生成` : ''}</span></h3>
        {!latestEval && <p className="dim-note">先请求一次评估，建议会出现在这里。</p>}
        {latestEval && suggestions.length === 0 && <p className="dim-note">本轮评估没有具体建议——按当前实测指标画面状态良好。</p>}
        {suggestions.map(s => {
          const dec = decisions.get(s.id)
          return (
            <article
              key={s.id}
              className={`sugg-card${selectedSuggId === s.id ? ' pinned' : ''}${dec?.status === 'rejected' ? ' rejected' : ''}`}
              data-testid="suggestion-card"
              title="点击可固定画布区域高亮"
              onClick={() => setSelectedSuggId(selectedSuggId === s.id ? null : s.id)}
              onMouseEnter={() => setHover(s.region ? { region: s.region, severity: s.severity } : null)}
              onMouseLeave={() => setHover(null)}
            >
              <header className="sugg-head">
                <span className={`sev-badge ${severityClass(s.severity)}`}>{SEVERITY_LABEL[s.severity]}</span>
                <span className="kind-chip">{KIND_ICON[s.kind]} {KIND_LABEL[s.kind]}</span>
                <span className="sugg-title">{s.title}</span>
              </header>
              <p className="sugg-line"><b>问题</b>{highlightNumbers(s.problem)}</p>
              <p className="sugg-line"><b>理由</b>{highlightNumbers(s.reason)}</p>
              <p className="sugg-line"><b>建议</b>{highlightNumbers(s.fix)}</p>
              {s.region && <span className="region-tag" title="悬停/选中可在画布上查看目标区域">◱ 目标区域</span>}

              <details className="draft-box">
                <summary>生成提示词草稿（含实测数字）</summary>
                <p>{highlightNumbers(dec?.promptOverride ?? s.promptDraft)}</p>
              </details>

              {adjusting?.id === s.id ? (
                <div className="adjust-editor" onClick={e => e.stopPropagation()}>
                  <textarea
                    rows={4}
                    data-testid="adjust-textarea"
                    value={adjusting.text}
                    onChange={e => setAdjusting({ id: s.id, text: e.target.value })}
                  />
                  <div className="adjust-actions">
                    <button className="btn-primary" data-testid="adjust-save" onClick={saveAdjust}>保存并加入待生成</button>
                    <button onClick={() => setAdjusting(null)}>取消</button>
                  </div>
                </div>
              ) : dec?.status === 'accepted' ? (
                <div className="sugg-actions">
                  <span className="dec-chip accepted" data-testid="sugg-accepted">
                    ✓ 已接受 · 待生成{dec.promptOverride ? '（已调整）' : ''}
                  </span>
                  <button data-testid="sugg-adjust" onClick={e => { e.stopPropagation(); setAdjusting({ id: s.id, text: dec.promptOverride ?? s.promptDraft }) }}>调整</button>
                  <button onClick={e => { e.stopPropagation(); decide(s, 'reject') }}>拒绝</button>
                </div>
              ) : dec?.status === 'rejected' ? (
                <div className="sugg-actions">
                  <span className="dec-chip rejected">已拒绝</span>
                  <button onClick={e => { e.stopPropagation(); decide(s, 'accept') }}>重新接受</button>
                </div>
              ) : (
                <div className="sugg-actions">
                  <button className="btn-primary" data-testid="sugg-accept" onClick={e => { e.stopPropagation(); decide(s, 'accept') }}>接受</button>
                  <button data-testid="sugg-reject" onClick={e => { e.stopPropagation(); decide(s, 'reject') }}>拒绝</button>
                  <button data-testid="sugg-adjust" onClick={e => { e.stopPropagation(); setAdjusting({ id: s.id, text: s.promptDraft }) }}>调整</button>
                </div>
              )}
            </article>
          )
        })}
      </section>

      {/* ③ 生成区 */}
      <section className="ai-section" data-testid="generate-section">
        <h3>③ 生成 <span className="panel-sub">编辑后的文本才是实际发送内容</span></h3>

        <div className="gen-source">
          {queue.length === 0
            ? <span className="dim-note">暂无已接受建议——可在上方接受一条，或直接手动生成。</span>
            : (
              <div className="chip-row">
                {queue.map(s => (
                  <button
                    key={s.id}
                    className={`chip-btn${genSourceId === s.id ? ' active' : ''}`}
                    data-testid="gen-source-chip"
                    title={`${s.title}（${SCOPE_LABEL[s.scope]}）`}
                    onClick={() => pickSource(s.id)}
                  >
                    {KIND_ICON[s.kind]} {s.title}
                  </button>
                ))}
                <button className={`chip-btn${manualActive ? ' active' : ''}`} onClick={() => pickSource('manual')}>手动</button>
              </div>
            )}
          {queue.length > 0 && genSourceId === null && <p className="dim-note">选择一条已接受建议自动填入草稿，或点「手动」。</p>}
        </div>

        <div className="scope-select" role="radiogroup" aria-label="修改范围 scope">
          {ALL_SCOPES.map(sc => (
            <button
              key={sc}
              className={scope === sc ? 'active' : ''}
              title={`仅调整${SCOPE_LABEL[sc]}，其余保持原样`}
              onClick={() => setScope(sc)}
            >
              {SCOPE_LABEL[sc]}
            </button>
          ))}
        </div>

        <textarea
          className="prompt-editor"
          rows={5}
          data-testid="prompt-textarea"
          value={promptText}
          onChange={e => setPromptText(e.target.value)}
          placeholder={'选择已接受建议自动填入草稿，或手动输入；发送前可自由编辑'}
        />

        <div className="gen-tools">
          <button onClick={() => void applyTemplate()} disabled={tplReq.phase === 'loading'} title="调 /api/prompt/build 由服务端模板重写提示词">
            {tplReq.phase === 'loading' ? '构建中…' : '套用服务端模板'}
          </button>
          <label className="sim-fail" title="演示失败路径：服务端 800ms 后返回 502 可重试">
            <input type="checkbox" checked={simulateFail} onChange={e => setSimulateFail(e.target.checked)} data-testid="simulate-fail" />
            模拟生成失败
          </label>
        </div>

        <button
          className="btn-primary wide"
          data-testid="generate-trigger"
          onClick={() => void runGenerate()}
          disabled={genReq.phase === 'loading' || !engine}
        >
          {genReq.phase === 'loading' ? <><span className="spinner" />生成中…</> : '生成修正版'}
        </button>
        {genReq.phase === 'error' && (
          <div className="error-banner" data-testid="generate-error">
            <span>生成失败：{genReq.message}</span>
            <button onClick={() => void runGenerate()}>重试</button>
          </div>
        )}
        {compare && <p className="dim-note">对比视图已打开——请在弹层中「采纳」或「放弃」。</p>}
      </section>

      {/* 画布区域联动高亮（选中 > 悬停） */}
      <RegionOverlay region={activeRegion} severity={activeSeverity} />

      {/* 对比弹层：左右并排 原画布 vs 修正版，采纳才改画布 */}
      {compare && (
        <div className="modal-backdrop" data-testid="compare-modal">
          <div className="modal compare-modal">
            <header className="modal-head">对比 · 是否采纳修正版？</header>
            <div className="compare-body">
              <figure className="compare-fig">
                <img src={compare.original} alt="原画布" />
                <figcaption>原画布 · 生成请求发送时的画面</figcaption>
              </figure>
              <figure className="compare-fig">
                <img src={compare.generation.image} alt="修正版" data-testid="compare-generation" />
                <figcaption>
                  {compare.generation.provider} · {compare.generation.mode} · {SCOPE_LABEL[compare.generation.scope]}修正
                  <span className="compare-note">{compare.generation.note}</span>
                </figcaption>
              </figure>
            </div>
            <footer className="modal-foot">
              <button className="btn-primary" data-testid="adopt-btn" onClick={() => void adopt()} disabled={adopting}>
                {adopting ? <><span className="spinner" />采纳中…</> : '采纳（画上并进入下一轮）'}
              </button>
              <button data-testid="discard-btn" onClick={() => { setCompare(null); toast('已放弃该修正版', 'info') }}>
                放弃
              </button>
            </footer>
          </div>
        </div>
      )}
    </aside>
  )
}
