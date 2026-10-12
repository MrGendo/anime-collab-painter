// 左侧竖向工具栏：画笔/橡皮/色板/自定义色/粗细/撤销/重做/清空/网格
import { useCanvas } from '../canvas/CanvasProvider'

// 8 色板：动画线稿常用色（深墨/靛/天蓝/青/绿/暖黄/橙/绯红）
const PALETTE = ['#1B1B1F', '#2C4B7C', '#4C8BD4', '#3FB8AF', '#4CA64C', '#F5C542', '#F08A3C', '#D64550']

export default function ToolBar() {
  const { engine, mirror, setTool, setColor, setSize, toggleGrid } = useCanvas()

  function clearWithConfirm() {
    // 契约：清空为破坏性操作，必须二次确认
    if (!engine) return
    if (window.confirm('确定清空画布？此操作可用撤销恢复。')) engine.clear()
  }

  return (
    <nav className="toolbar" aria-label="绘制工具">
      <button
        className={`tool-btn${mirror.tool === 'brush' ? ' active' : ''}`}
        title="画笔"
        onClick={() => setTool('brush')}
      >
        🖌
      </button>
      <button
        className={`tool-btn${mirror.tool === 'eraser' ? ' active' : ''}`}
        title="橡皮"
        onClick={() => setTool('eraser')}
      >
        🧽
      </button>

      <div className="tool-sep" />

      <div className="palette" role="group" aria-label="颜色板">
        {PALETTE.map(c => (
          <button
            key={c}
            className={`swatch${mirror.color === c && mirror.tool === 'brush' ? ' active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => { setColor(c); setTool('brush') }}
          />
        ))}
      </div>
      {/* 原生 color input 作为自定义色入口 */}
      <input
        className="custom-color"
        type="color"
        title="自定义颜色"
        value={mirror.color}
        onChange={e => { setColor(e.target.value); setTool('brush') }}
      />

      <div className="tool-sep" />

      <input
        className="size-slider"
        type="range"
        min={1}
        max={40}
        step={1}
        title={`笔刷粗细 ${mirror.size}px`}
        value={mirror.size}
        onChange={e => setSize(Number(e.target.value))}
      />
      <span className="size-label">{mirror.size}px</span>

      <div className="tool-sep" />

      <button className="tool-btn" title="撤销" disabled={!mirror.canUndo} onClick={() => engine?.undo()}>↩</button>
      <button className="tool-btn" title="重做" disabled={!mirror.canRedo} onClick={() => engine?.redo()}>↪</button>
      <button className="tool-btn" title="清空画布" disabled={mirror.empty} onClick={clearWithConfirm}>🗑</button>

      <div className="tool-sep" />

      <button
        className={`tool-btn${mirror.grid ? ' active' : ''}`}
        title={mirror.grid ? '关闭参考网格' : '开启点状参考网格'}
        onClick={toggleGrid}
      >
        ⋮⋅⋅
      </button>
    </nav>
  )
}
