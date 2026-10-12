// 状态条右侧「可评估提示」（design §7 状态条职责，INTEGRATION §4）：
// 直接读 useCanvas().mirror.empty —— empty=false 即可评估；绝不自动发评估，只提示
import { useCanvas } from '../canvas/CanvasProvider'

export default function EvalHint() {
  const { mirror } = useCanvas()
  return (
    <span className={`eval-hint${mirror.empty ? '' : ' ready'}`} data-testid="eval-hint">
      <i className="eval-hint-dot" />
      {mirror.empty ? '画布为空 · 先绘制几笔再请求评估' : '画布已就绪 · 可请求 AI 评估'}
    </span>
  )
}
