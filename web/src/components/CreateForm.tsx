// 无项目时的居中创建表单：标题/主题/角色设定/画面目标，全部必填
import { useState } from 'react'
import { useApp } from '../state/AppProvider'
import { ApiError } from '../api/client'

interface FormState { title: string; theme: string; character: string; goal: string }

const EMPTY: FormState = { title: '', theme: '', character: '', goal: '' }

export default function CreateForm() {
  const { createProject } = useApp()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  function set<K extends keyof FormState>(key: K, v: string) {
    setForm(f => ({ ...f, [key]: v }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // 必填校验：空或纯空白都算未填
    const errs: Partial<Record<keyof FormState, string>> = {}
    for (const k of Object.keys(form) as (keyof FormState)[]) {
      if (!form[k].trim()) errs[k] = '此项为必填'
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    setSubmitting(true)
    setServerError('')
    try {
      await createProject({
        title: form.title.trim(), theme: form.theme.trim(),
        character: form.character.trim(), goal: form.goal.trim(),
      })
      // 成功后由 App 切换到工作台视图
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : '创建失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="create-wrap">
      <form className="create-card" onSubmit={submit} noValidate>
        <h1>创建绘画项目</h1>
        <p className="sub">动画工作室 · 人工主导、AI 辅助 —— 先立主题，再落笔</p>

        <div className="field">
          <label>项目标题 <span className="req">*</span></label>
          <input
            value={form.title}
            onChange={e => set('title', e.target.value)}
            placeholder="例：雨夜的猫站台员"
          />
          {errors.title && <div className="err">{errors.title}</div>}
        </div>

        <div className="field">
          <label>动画主题 <span className="req">*</span></label>
          <input
            value={form.theme}
            onChange={e => set('theme', e.target.value)}
            placeholder="例：吉卜力式治愈日常 / 赛博朋克街景 / 水墨武侠"
          />
          {errors.theme && <div className="err">{errors.theme}</div>}
        </div>

        <div className="field">
          <label>角色设定 <span className="req">*</span></label>
          <textarea
            value={form.character}
            onChange={e => set('character', e.target.value)}
            placeholder="例：橘白相间的少女猫，戴旧式列车员帽，琥珀色眼睛，尾巴尖有一撮白毛"
          />
          {errors.character && <div className="err">{errors.character}</div>}
        </div>

        <div className="field">
          <label>画面目标 <span className="req">*</span></label>
          <textarea
            value={form.goal}
            onChange={e => set('goal', e.target.value)}
            placeholder="例：雨夜站台一幕——角色在灯下撑伞回望，远处列车灯光晕染湿漉地面"
          />
          {errors.goal && <div className="err">{errors.goal}</div>}
        </div>

        {serverError && <div className="err" style={{ marginBottom: 10 }}>{serverError}</div>}

        <button className="create-submit" type="submit" disabled={submitting}>
          {submitting ? '创建中…' : '开始创作'}
        </button>
      </form>
    </div>
  )
}
