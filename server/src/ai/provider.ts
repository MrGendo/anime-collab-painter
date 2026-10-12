// AIProvider 接口与选择逻辑（design.md §4）。
// real.ts 属于 Wave 2D，本期不存在：通过变量形式的动态 import 探测（tsc 不做静态解析），
// 探测失败即回落 mock —— 2D 落入 real.ts 后无需改动本文件即可自动启用。
import type { Evaluation, ProjectMeta, Region, Scope, Stage } from '../types.js';

/** evaluate 返回体 = Evaluation 去掉 id/latencyMs（由路由层补齐） */
export type EvaluationCore = Omit<Evaluation, 'id' | 'latencyMs'>;

export interface AIProvider {
  name: string; mode: 'mock' | 'real';
  evaluate(input: { meta: ProjectMeta; stage: Stage; round: number; image: Buffer; metrics: { strokes: number; sessionMs: number } }): Promise<EvaluationCore>;
  generate(input: { meta: ProjectMeta; stage: Stage; scope: Scope; prompt: string; image: Buffer; region?: Region; simulateFail?: boolean }): Promise<{ image: Buffer; note: string }>;
}

export interface ProviderConfig {
  mode: 'mock' | 'real';
  hasLlmKey: boolean; hasImgKey: boolean;
  llmModel?: string; imgModel?: string;
  mockNote: string;
}

let provider: AIProvider | null = null;
let config: ProviderConfig | null = null;

/** env 满足 real 条件：AI_PROVIDER=real 且 LLM/IMG 两把 key 齐备 */
function wantsReal(): boolean {
  return process.env.AI_PROVIDER === 'real' && !!process.env.LLM_API_KEY && !!process.env.IMG_API_KEY;
}

/** 解析（并缓存）当前 provider 与对外 config；real 不可用时如实回落 mock */
export async function getProvider(): Promise<{ provider: AIProvider; config: ProviderConfig }> {
  if (provider && config) return { provider, config };
  if (wantsReal()) {
    try {
      const spec = './real.js'; // 用变量阻止 tsc 静态解析缺失模块（real.ts 为 Wave 2D 交付物）
      const mod: { realProvider: AIProvider } = await import(/* @vite-ignore */ spec);
      provider = mod.realProvider;
      config = {
        mode: 'real', hasLlmKey: true, hasImgKey: true,
        llmModel: process.env.LLM_MODEL, imgModel: process.env.IMG_MODEL,
        mockNote: '真实模型模式',
      };
      return { provider, config };
    } catch {
      // real.ts 尚未交付（Wave 2D）→ 回落 mock，并在 config 中如实说明
    }
  }
  const { mockProvider } = await import('./mock.js');
  provider = mockProvider;
  config = {
    mode: 'mock',
    hasLlmKey: !!process.env.LLM_API_KEY, hasImgKey: !!process.env.IMG_API_KEY,
    llmModel: process.env.LLM_MODEL, imgModel: process.env.IMG_MODEL,
    mockNote: wantsReal()
      ? '已配置 AI_PROVIDER=real 且 key 齐备，但真实 provider 尚未接入（Wave 2D 交付），当前回落 mock 演示模式'
      : `mock 演示模式：评估与生成均基于服务端真实像素度量，确定性输出（模拟延迟 ${process.env.MOCK_LATENCY_MS ?? 600}ms）。配置 AI_PROVIDER=real 及 LLM/IMG key 可切换真实模型`,
  };
  return { provider, config };
}
