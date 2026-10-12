// 应用外壳：无项目 → 创建表单；有项目 → 工作台（顶栏/工具栏/画布/状态条/AI 面板/历史条）
// Wave 2C：接入统一 toast（ToastProvider）、状态条可评估提示（EvalHint）与新样式表
import { useEffect, useRef } from 'react'
import { AppProvider, useApp } from './state/AppProvider'
import { CanvasProvider, CanvasSurface } from './canvas/CanvasProvider'
import { ToastProvider, useToast } from './status/ToastProvider'
import TopBar from './components/TopBar'
import ToolBar from './components/ToolBar'
import StatusBar from './components/StatusBar'
import CreateForm from './components/CreateForm'
import AIPanel from './ai/AIPanel'
import HistoryBar from './history/HistoryBar'
import EvalHint from './status/EvalHint'
import './styles/status.css'
import './styles/ai.css'
import './styles/history.css'

/** 保存最终失败 → 汇入统一 toast（statusbar 徽章之外的显式提醒，可重试） */
function SaveErrorToast() {
  const { state, saveNow } = useApp()
  const { toast } = useToast()
  const failed = state.save === 'error'
  const prev = useRef(failed)

  useEffect(() => {
    // 只在刚进入失败态时提醒一次，恢复后不打扰（toast 会自动消失）
    if (failed && !prev.current) {
      toast('保存失败：已自动重试 2 次仍未成功', 'error', { retry: () => { void saveNow() } })
    }
    prev.current = failed
  }, [failed, saveNow, toast])

  return null
}

function Workspace() {
  const { state } = useApp()
  const docId = state.doc?.meta.id

  return (
    <div className="app-shell">
      <TopBar />
      <ToolBar />
      <main className="main-area">
        <CanvasSurface />
      </main>
      <div className="statusbar-slot">
        <StatusBar />
        <EvalHint />
      </div>
      <div className="ai-area">
        <AIPanel docId={docId} />
      </div>
      <div className="history-slot">
        <HistoryBar docId={docId} />
      </div>
      <SaveErrorToast />
    </div>
  )
}

function Root() {
  const { state } = useApp()
  return state.doc ? <Workspace /> : <CreateForm />
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <CanvasProvider>
          <Root />
        </CanvasProvider>
      </ToastProvider>
    </AppProvider>
  )
}
