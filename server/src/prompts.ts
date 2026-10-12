// 阶段 × 任务 Prompt 模板注册表（design.md §6，服务端唯一来源）。
// 评估模板按 stage 组合、生成模板按 scope 选择；/api/prompt/build 的返回全部产自本文件。
import type { AnalyzerMetrics } from './ai/analyzer.js';
import type { ProjectMeta, Scope, Stage } from './types.js';

export type TemplateName =
  | 'composition-eval' | 'consistency-eval' | 'pose-fix' | 'contour-fix'
  | 'color-harmony' | 'background-fill' | 'local-edit' | 'style-unify';

export interface PromptContext {
  meta: ProjectMeta;
  stage: Stage;
  scope?: Scope;
  metrics: AnalyzerMetrics;                 // 实测数字来源
  basePrompt?: string;                      // 用户底稿（可选）
  suggestionFix?: string;                   // 命中建议的 fix（可编辑前内容）
  suggestionPromptDraft?: string;           // 命中建议的 promptDraft
}

export interface BuiltPrompt { system: string; user: string; finalPrompt: string; templateName: TemplateName }

const m = (c: PromptContext) =>
  `实测数据：覆盖率 ${c.metrics.coverage}%；主体包围盒占画面 ${c.metrics.bbox ? (c.metrics.bbox.w * c.metrics.bbox.h * 100).toFixed(1) : '0.0'}%；质心 ${c.metrics.centroid ? `(${c.metrics.centroid.x},${c.metrics.centroid.y})` : '无内容'}；去重色数 ${c.metrics.distinctColors}；边缘密度 ${c.metrics.edgeRatio}；上/下三分之一空白 ${c.metrics.topEmpty}/${c.metrics.bottomEmpty}；左/右 1/3 内容占比 ${c.metrics.leftShare}%/${c.metrics.rightShare}%。`;

const setting = (c: PromptContext) => `动画主题「${c.meta.theme}」，角色设定「${c.meta.character}」，画面目标「${c.meta.goal}」。`;

const SCOPE_LIMIT: Record<Scope, string> = {
  pose: '仅调整姿态与位置，保持轮廓、配色与背景不变',
  contour: '仅加粗修复线条，不改变姿态、配色与背景',
  color: '仅调整配色，保持轮廓、姿态与背景不变',
  background: '仅补绘背景，不改动主体轮廓、姿态与配色',
  local: '仅在指定 region 内调整，区域外像素保持原样',
  global: '允许全图调整，但需保持主体可识别与构图骨架',
};

interface Template { kind: 'eval' | 'gen'; system: string; user: (c: PromptContext) => string }

// —— 8 个模板 ——
export const TEMPLATES: Record<TemplateName, Template> = {
  'composition-eval': {
    kind: 'eval',
    system: '你是动画工作室的构图指导。只依据给定的实测像素度量做构图判断，禁止臆造画面内容；输出问题、理由与可执行修改建议。',
    user: c => `【构图评估·${c.stage} 阶段】\n${setting(c)}\n${m(c)}\n请从主体位置、占比、画面平衡三方面给出结论，并引用上述实测数字。`,
  },
  'consistency-eval': {
    kind: 'eval',
    system: '你是动画角色一致性审核员。对照角色设定与实测结构信号，检查画面是否偏离设定；明确说明判断依据是结构信号而非语义识别。',
    user: c => `【一致性评估·${c.stage} 阶段】\n${setting(c)}\n${m(c)}\n请核对主体尺度、位置与色彩数量是否支撑角色设定的可识别性，引用实测数字。`,
  },
  'pose-fix': {
    kind: 'gen',
    system: '你是动画绘图师，执行姿态修正任务。严格限定修改范围，未提及的元素一律保持原样。',
    user: c => `【姿态修正任务·${c.stage} 阶段】\n${setting(c)}\n${m(c)}${c.suggestionFix ? `\n建议要求：${c.suggestionFix}` : ''}${c.suggestionPromptDraft ? `\n建议草稿：${c.suggestionPromptDraft}` : ''}\n${SCOPE_LIMIT.pose}${c.basePrompt ? `\n用户补充：${c.basePrompt}` : ''}`,
  },
  'contour-fix': {
    kind: 'gen',
    system: '你是动画线稿师，执行轮廓修复任务。只处理线条本身，不触碰配色、姿态与背景。',
    user: c => `【轮廓修复任务·${c.stage} 阶段】\n${setting(c)}\n${m(c)}${c.suggestionFix ? `\n建议要求：${c.suggestionFix}` : ''}${c.suggestionPromptDraft ? `\n建议草稿：${c.suggestionPromptDraft}` : ''}\n${SCOPE_LIMIT.contour}${c.basePrompt ? `\n用户补充：${c.basePrompt}` : ''}`,
  },
  'color-harmony': {
    kind: 'gen',
    system: '你是动画上色师，执行色彩调和任务。仅调整色彩关系，轮廓、姿态与构图保持不变。',
    user: c => `【色彩调和任务·${c.stage} 阶段】\n${setting(c)}\n${m(c)}\n当前 Top 色板：${c.metrics.palette.map(p => `rgb(${p.rgb.join(',')}) ${p.share}%`).join('、') || '无'}。${c.suggestionFix ? `建议要求：${c.suggestionFix}。` : ''}${c.suggestionPromptDraft ? `建议草稿：${c.suggestionPromptDraft}。` : ''}${SCOPE_LIMIT.color}${c.basePrompt ? `\n用户补充：${c.basePrompt}` : ''}`,
  },
  'background-fill': {
    kind: 'gen',
    system: '你是动画背景师，执行背景补绘任务。主体像素一律保留，只填充空白区域。',
    user: c => `【背景补绘任务·${c.stage} 阶段】\n${setting(c)}\n${m(c)}\n优先补绘最空区域（实测最空格为 ${c.metrics.emptiestCell} 号，下 1/3 空白 ${c.metrics.bottomEmpty}）。${c.suggestionFix ? `建议要求：${c.suggestionFix}。` : ''}${c.suggestionPromptDraft ? `建议草稿：${c.suggestionPromptDraft}。` : ''}${SCOPE_LIMIT.background}${c.basePrompt ? `\n用户补充：${c.basePrompt}` : ''}`,
  },
  'local-edit': {
    kind: 'gen',
    system: '你是动画修图师，执行局部编辑任务。region 之外的所有像素保持原样。',
    user: c => `【局部编辑任务·${c.stage} 阶段】\n${setting(c)}\n${m(c)}${c.suggestionFix ? `\n建议要求：${c.suggestionFix}` : ''}${c.suggestionPromptDraft ? `\n建议草稿：${c.suggestionPromptDraft}` : ''}\n${SCOPE_LIMIT.local}${c.basePrompt ? `\n用户补充：${c.basePrompt}` : ''}`,
  },
  'style-unify': {
    kind: 'gen',
    system: '你是动画监督，执行全图风格统一/收尾任务。保持主体可识别与构图骨架，做整体性协调。',
    user: c => `【风格统一任务·${c.stage} 阶段】\n${setting(c)}\n${m(c)}${c.suggestionFix ? `\n建议要求：${c.suggestionFix}` : ''}${c.suggestionPromptDraft ? `\n建议草稿：${c.suggestionPromptDraft}` : ''}\n${SCOPE_LIMIT.global}${c.basePrompt ? `\n用户补充：${c.basePrompt}` : ''}`,
  },
};

// 评估模板按 stage 组合（§6）：sketch→构图+目标；lineart→构图+一致性+轮廓；color→一致性+色彩+目标；detail→全维度
const EVAL_BY_STAGE: Record<Stage, TemplateName[]> = {
  sketch: ['composition-eval', 'style-unify'],
  lineart: ['composition-eval', 'consistency-eval', 'contour-fix'],
  color: ['consistency-eval', 'color-harmony', 'style-unify'],
  detail: ['composition-eval', 'consistency-eval', 'contour-fix', 'color-harmony', 'style-unify'],
};

// 生成模板按 scope 选择
const GEN_BY_SCOPE: Record<Scope, TemplateName> = {
  pose: 'pose-fix', contour: 'contour-fix', color: 'color-harmony',
  background: 'background-fill', local: 'local-edit', global: 'style-unify',
};

export function evalTemplatesForStage(stage: Stage): TemplateName[] { return EVAL_BY_STAGE[stage]; }

export function generateTemplateForScope(scope: Scope): TemplateName { return GEN_BY_SCOPE[scope]; }

/** 组装单个模板的完整 prompt（/api/prompt/build 使用；返回仅供展示/编辑，不落盘） */
export function buildPrompt(c: PromptContext): BuiltPrompt {
  const name = c.scope ? GEN_BY_SCOPE[c.scope] : EVAL_BY_STAGE[c.stage][0];
  const t = TEMPLATES[name];
  const user = t.user(c);
  return { system: t.system, user, finalPrompt: `${t.system}\n\n${user}`, templateName: name };
}
