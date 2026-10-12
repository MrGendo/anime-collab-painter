// 建议区域联动画布：把归一化 region 换算成画布视口像素，叠加半透明高亮框
// 纯 overlay 实现（fixed 定位贴着 .canvas-host 的实时 rect），不改画布引擎、不进导出
import { useLayoutEffect, useState } from 'react'
import type { Region, Severity } from '../types'

interface Box { left: number; top: number; width: number; height: number }

/** severity → 高亮框色（high 红 / medium 橙 / low 灰，未知用主强调色） */
function toneClass(severity?: Severity): string {
  if (severity === 'high') return 'tone-high'
  if (severity === 'medium') return 'tone-medium'
  if (severity === 'low') return 'tone-low'
  return 'tone-base'
}

export default function RegionOverlay({ region, severity }: { region: Region | null; severity?: Severity }) {
  const [box, setBox] = useState<Box | null>(null)

  useLayoutEffect(() => {
    if (!region) { setBox(null); return }
    const host = document.querySelector('.canvas-host')
    if (!host) { setBox(null); return }
    // 归一化 0..1 → 画布视口像素；fixed 定位需在 resize/滚动时重算
    const compute = () => {
      const r = host.getBoundingClientRect()
      setBox({
        left: r.left + region.x * r.width,
        top: r.top + region.y * r.height,
        width: region.w * r.width,
        height: region.h * r.height,
      })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [region])

  if (!region || !box) return null
  return (
    <div
      className={`region-overlay ${toneClass(severity)}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      data-testid="region-overlay"
    />
  )
}
