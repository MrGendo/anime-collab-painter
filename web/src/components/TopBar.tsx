// 顶栏：项目信息 chips + 阶段切换 + 模式/健康徽章 + Round + 新建项目
import { useApp } from '../state/AppProvider'
import type { Stage } from '../types'

const STAGES: { key: Stage; label: string }[] = [
  { key: 'sketch', label: '草稿' },
  { key: 'lineart', label: '线稿' },
  { key: 'color', label: '上色' },
  { key: 'detail', label: '细化' },
]

export default function TopBar() {
  const { state, setStage, saveNow } = useApp()
  const { doc, health, config } = state
  if (!doc) return null

  const modeClass = !config ? 'badge-mode-off' : config.mode === 'mock' ? 'badge-mode-mock' : 'badge-mode-real'
  const modeText = !config
    ? '模式未知（后端未连接）'
    : config.mode === 'mock' ? 'Mock 演示模式' : `真实模型${config.llmModel ? ' · ' + config.llmModel : ''}`
  const healthClass = health === 'ok' ? 'badge-health-ok' : health === 'offline' ? 'badge-health-off' : 'badge-health-checking'
  const healthText = health === 'ok' ? '在线' : health === 'offline' ? '离线' : '检查中…'

  function newProject() {
    // 先落盘当前项目（fire-and-forget，PUT 已带防抖重试），再回创建表单
    if (!confirm('新建项目？当前项目已自动保存，历史保留在服务端')) return
    void saveNow()
    localStorage.removeItem('tib.currentProject')
    location.reload()
  }

  return (
    <header className="topbar">
      <span className="topbar-title">{doc.meta.title}</span>
      <div className="topbar-chips">
        <span className="chip"><b>主题</b> {doc.meta.theme}</span>
        <span className="chip"><b>角色</b> {doc.meta.character}</span>
        <span className="chip"><b>目标</b> {doc.meta.goal}</span>
      </div>
      <nav className="stage-switch" aria-label="阶段切换">
        {STAGES.map(s => (
          <button
            key={s.key}
            className={doc.stage === s.key ? 'active' : ''}
            onClick={() => setStage(s.key)}
            disabled={doc.stage === s.key}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <span className={`badge ${modeClass}`}>{modeText}</span>
      <span className={`badge ${healthClass}`}>{healthText}</span>
      <span className="badge badge-round">Round {doc.round}</span>
      <button className="topbar-new" onClick={newProject} title="保存当前项目并新建">＋ 新建</button>
    </header>
  )
}
