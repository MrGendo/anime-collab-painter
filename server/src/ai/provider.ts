// AIProvider 接口与选择逻辑（design.md §4）。
// 三种工作模式（按 env 自动判定，/api/config 如实上报）：
//   mock            —— 无 key：评估与生成均走确定性像素度量/变换
//   real            —— LLM+IMG 双 key：评估与生成均走真实模型
//   real-eval-mock-gen —— 仅 LLM key：评估走真实多模态模型，图像生成回落 mock（note 如实标注）
// 协议：LLM_BASE_URL 含 /anthropic → Anthropic messages（GLM coding plan 额度端点），否则 OpenAI 兼容。
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

const wantsReal = () => process.env.AI_PROVIDER === 'real' && !!process.env.LLM_API_KEY;

/** 解析（并缓存）当前 provider 与对外 config；real 不可用时如实回落 mock */
export async function getProvider(): Promise<{ provider: AIProvider; config: ProviderConfig }> {
  if (provider && config) return { provider, config };
  if (wantsReal()) {
    try {
      const spec = './real.js';
      const mod: { realProvider: AIProvider } = await import(/* @vite-ignore */ spec);
      const hasImg = !!process.env.IMG_API_KEY;
      if (hasImg) {
        provider = mod.realProvider;
        config = {
          mode: 'real', hasLlmKey: true, hasImgKey: true,
          llmModel: process.env.LLM_MODEL, imgModel: process.env.IMG_MODEL,
          mockNote: '真实模型模式：评估与生成均调用真实模型',
        };
      } else {
        // 混合模式：评估用真实 LLM，生成回落 mock —— 组合 provider，诚实标注
        const { mockProvider } = await import('./mock.js');
        provider = {
          name: 'real-eval+mock-gen', mode: 'real',
          evaluate: mod.realProvider.evaluate.bind(mod.realProvider),
          generate: async (input) => {
            const out = await mockProvider.generate(input);
            return { ...out, note: `${out.note}；【混合模式】未配置 IMG_API_KEY，图像生成为确定性像素变换（非真实模型）；评估为真实模型` };
          },
        };
        config = {
          mode: 'real', hasLlmKey: true, hasImgKey: false,
          llmModel: process.env.LLM_MODEL, imgModel: process.env.IMG_MODEL,
          mockNote: '真实模型评估模式：AI 评分由真实多模态大模型给出；未配置 IMG_API_KEY，图像生成回落 Mock 像素变换',
        };
      }
      return { provider, config };
    } catch (e) {
      // real.ts 加载失败 → 回落 mock，并在 config 中如实说明
    }
  }
  const { mockProvider } = await import('./mock.js');
  provider = mockProvider;
  config = {
    mode: 'mock',
    hasLlmKey: !!process.env.LLM_API_KEY, hasImgKey: !!process.env.IMG_API_KEY,
    llmModel: process.env.LLM_MODEL, imgModel: process.env.IMG_MODEL,
    mockNote: wantsReal()
      ? 'AI_PROVIDER=real 已设置但真实 provider 加载失败，当前回落 mock 演示模式'
      : `mock 演示模式：评估与生成均基于服务端真实像素度量，确定性输出（模拟延迟 ${process.env.MOCK_LATENCY_MS ?? 600}ms）。配置 AI_PROVIDER=real 及 LLM key 可切换真实模型评估`,
  };
  return { provider, config };
}
