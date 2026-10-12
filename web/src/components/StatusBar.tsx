// 底部状态条：strokes 计数 / 保存态 / 离线提示
import { useApp } from '../state/AppProvider'
import { useCanvas } from '../canvas/CanvasProvider'

export default function StatusBar() {
  const { state } = useApp()
  const { mirror } = useCanvas()
  const { health, save } = state

  const saveText = save === 'saving' ? '保存中…' : save === 'saved' ? '已保存' : save === 'error' ? '保存失败（已重试 2 次）' : '就绪'
  const saveDot = save === 'saving' ? 'saving' : 'ok'

  return (
    <div className="statusbar" data-testid="statusbar">
      <span>笔画 <b>{mirror.strokes}</b></span>
      <span className="spacer" />
      <span>
        <i className={`dot ${health === 'ok' ? 'dot-ok' : 'dot-off'}`} />
        {health === 'ok' ? '已连接协作服务' : '后端离线——绘制不受影响，保存与 AI 功能暂不可用'}
      </span>
      <span>
        <i className={`dot dot-${saveDot}`} />
        {saveText}
      </span>
    </div>
  )
}
