// Wave 2C 使用的全局 toast 槽位：本期渲染容器与签名冻结，具体通知逻辑后续接入
// 接口见 web/INTEGRATION.md
export interface ToastItem {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
  /** 提供时展示重试按钮 */
  retry?: () => void
}

export interface ToastHostProps {
  items: ToastItem[]
  onDismiss: (id: number) => void
}

export default function ToastHost({ items, onDismiss }: ToastHostProps) {
  if (items.length === 0) return null
  return (
    <div className="toast-host" data-testid="toast-host">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          {t.retry && <button className="toast-retry" onClick={t.retry}>重试</button>}
          <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="关闭">×</button>
        </div>
      ))}
    </div>
  )
}
