// Mock provider（design.md §5）：基于 analyzer 真实像素度量按规则表生成评估，
// 全程确定性（禁 RNG / 禁时钟参与内容生成），延迟由 MOCK_LATENCY_MS 模拟。
import type { AIProvider, EvaluationCore } from './provider.js';
import { analyzePng, type AnalyzerMetrics } from './analyzer.js';
import type { Issue, Region, Suggestion, Severity, Stage, ProjectMeta } from '../types.js';

const LATENCY = () => Math.max(0, Number(process.env.MOCK_LATENCY_MS ?? 600));

// 各 scope 的限定语（拼进 promptDraft，明确“只改什么、保住什么”）
const SCOPE_QUALIFIER: Record<string, string> = {
  pose: '仅调整姿态与位置，保持轮廓、配色与背景不变',
  contour: '仅加粗修复线条，不改变姿态、配色与背景',
  color: '仅调整配色与色相关系，保持轮廓、姿态与背景不变',
  background: '仅补绘背景，不改动主体轮廓、姿态与配色',
  local: '仅在指定区域内调整，区域外像素保持原样',
  global: '允许全图调整，但需保持主体可识别与构图骨架',
};

const STAGE_ORDER: Stage[] = ['sketch', 'lineart', 'color', 'detail'];

function cellRegion(i: number): Region {
  return { x: +((i % 3) / 3).toFixed(3), y: +(Math.floor(i / 3) / 3).toFixed(3), w: +(1 / 3).toFixed(3), h: +(1 / 3).toFixed(3) };
}

/** character/goal 摘要：所有 promptDraft 必带，让建议可追溯到用户设定 */
function charGoal(meta: ProjectMeta): string {
  const g = meta.goal.length > 24 ? meta.goal.slice(0, 24) + '…' : meta.goal;
  return `角色「${meta.character}」目标「${g}」`;
}

function draft(meta: ProjectMeta, scope: keyof typeof SCOPE_QUALIFIER, body: string): string {
  return `${body}。${charGoal(meta)}。scope 限定：${SCOPE_QUALIFIER[scope]}`;
}

// overall.score 公式（design.md §5.2 要求写明）：
//   score = wCov*coverageScore                       覆盖率：欠画(<5%)扣分；>70% 时按色数分流——
//                                                  多色(≥3)满幅=完整场景不罚（画满背景是合法完成态）；
//                                                  近单色(≤2)满幅=平涂刷分，衰减到 0.35（涂满≠画完）
//         + 25*居中度                                1-2*max(|cx-0.5|,|cy-0.5|)，质心贴中心拿满
//         + wCol*min(distinctColors/5,1)             色彩：5 种主色满档；sketch/lineart 折半（此时色数无意义，权重让给覆盖率）
//         + 15*阶段推进分                            (stageIndex+1)/4，越接近 detail 越高
//   其中 sketch/lineart: wCov=50,wCol=10；color/detail: wCov=40,wCol=20（合计恒为 100）。
function coverageScore(coverage: number, distinctColors: number): number {
  // 0%→0；5%→0.25；25%~70%→1.0 平台；>70%：多色保持 1.0（合法满幅场景），近单色衰减（85%→0.6，100%→0.35）
  if (coverage < 5) return coverage / 20;
  if (coverage <= 70) return 0.25 + (0.75 * Math.min(coverage - 5, 20)) / 20;
  if (distinctColors >= 3) return 1;                     // 满幅但多色分层：完整场景，不罚
  if (coverage <= 85) return 1 - 0.4 * (coverage - 70) / 15;
  return Math.max(0.35, 0.6 - 0.25 * (coverage - 85) / 15);
}
function computeScore(m: AnalyzerMetrics, stage: Stage): number {
  const early = stage === 'sketch' || stage === 'lineart';
  const wCov = early ? 50 : 40, wCol = early ? 10 : 20;
  const cov = coverageScore(m.coverage, m.distinctColors);
  const center = m.centroid ? Math.max(0, 1 - 2 * Math.max(Math.abs(m.centroid.x - 0.5), Math.abs(m.centroid.y - 0.5))) : 0;
  const col = Math.min(m.distinctColors / 5, 1);
  const prog = (STAGE_ORDER.indexOf(stage) + 1) / 4;
  return Math.round(wCov * cov + 25 * center + wCol * col + 15 * prog);
}

function evaluateRules(m: AnalyzerMetrics, meta: ProjectMeta, stage: Stage, strokes: number) {
  const issues: Issue[] = [];
  const suggestions: Suggestion[] = [];
  let n = 0;
  const add = (iss: Omit<Issue, 'id'>, sug: Omit<Suggestion, 'id' | 'basedOnIssue'>) => {
    n++;
    issues.push({ ...iss, id: `iss-${n}` });
    suggestions.push({ ...sug, id: `sug-${n}`, basedOnIssue: `iss-${n}` });
  };

  const cg = charGoal(meta);

  // R1 覆盖率<2%：先解决“有没有画”
  if (m.coverage < 2) {
    const r = cellRegion(4); // 三分法中心格
    add(
      { kind: 'composition', severity: 'high', title: '画布几乎为空', detail: `实测覆盖率仅 ${m.coverage}%（阈值 2%），画面缺少可评估的主体内容`, region: r },
      {
        kind: 'composition', scope: 'global', severity: 'high',
        title: '先画主体剪影', problem: `覆盖率 ${m.coverage}%，AI 无法在空白画布上做构图评估`,
        reason: '协作闭环第一步需要主体剪影确定构图骨架，后续阶段都在其上迭代',
        fix: `在三分法中心格（x ${r.x}~${+(r.x + r.w).toFixed(3)}）勾勒完整主体剪影，占画面约 25%~40%`,
        region: r,
        promptDraft: draft(meta, 'global', `当前覆盖率实测 ${m.coverage}%，近乎空白。请在画面中心三分格绘制完整主体剪影（占画面 25%+），构图参考三分法`),
      },
    );
  }

  // R2 质心偏离中心带：构图失衡
  const cx = m.centroid?.x ?? 0.5;
  if (m.coverage >= 2 && (cx < 0.35 || cx > 0.65)) {
    const leftHeavy = cx < 0.35;
    const share = leftHeavy ? m.leftShare : m.rightShare;
    const side = leftHeavy ? '左' : '右';
    // 在内容较轻的一侧（3 个候选格）里挑最空格，作为建议的目标落位
    const col = leftHeavy ? 2 : 0;
    const cand = [col, col + 3, col + 6];
    const emptyIdx = cand.reduce((a, b) => (m.grid[b] < m.grid[a] ? b : a), cand[0]);
    const r = cellRegion(emptyIdx);
    add(
      { kind: 'composition', severity: 'high', title: '构图失衡', detail: `内容质心 x=${cx}，超出中心带（0.35~0.65）；实测内容 ${share}% 集中在${side}侧 1/3`, region: r },
      {
        kind: 'composition', scope: 'pose', severity: 'high',
        title: `主体向${leftHeavy ? '右' : '左'}侧留白区回移`, problem: `内容 ${share}% 挤在${side}侧 1/3，质心 x=${cx} 偏离中心`,
        reason: '单侧堆叠使画面失去视觉平衡，重心应回到中心带（x 0.35~0.65）',
        fix: `将主体平移至${side === '左' ? '右' : '左'}侧最空格（region x ${r.x}~${+(r.x + r.w).toFixed(3)}）附近，使质心回到 0.45~0.55`,
        region: r,
        promptDraft: draft(meta, 'pose', `实测内容 ${share}% 集中在${side}侧 1/3（质心 x=${cx}）。请平移主体位置/微调姿态，让构图重心回到画面中心带`),
      },
    );
  }

  // R3 lineart 阶段线条过浅
  if (stage === 'lineart' && m.edgeRatio < 0.02) {
    add(
      { kind: 'contour', severity: 'medium', title: '线条过浅/断线', detail: `线稿阶段实测边缘密度 ${m.edgeRatio}（阈值 0.02），线条浓度不足` },
      {
        kind: 'contour', scope: 'contour', severity: 'medium',
        title: '加粗并补全线稿', problem: `边缘密度实测 ${m.edgeRatio}，低于线稿阶段 0.02 的下限`,
        reason: '线稿是上色阶段的边界依据，过浅断线会导致上色溢出',
        fix: '对主体轮廓线整体加粗一档，并检查断点补全闭合',
        promptDraft: draft(meta, 'contour', `边缘密度实测 ${m.edgeRatio}（不足 0.02）。请加粗主体轮廓并补全断线，保持线稿闭合`),
      },
    );
  }

  // R4 color/detail 阶段尚未上色
  if ((stage === 'color' || stage === 'detail') && m.distinctColors <= 1) {
    add(
      { kind: 'color', severity: 'medium', title: '尚未上色', detail: `${stage} 阶段实测去重色数仅 ${m.distinctColors}（量化桶 32），画面仍是单色` },
      {
        kind: 'color', scope: 'color', severity: 'medium',
        title: '建立基础配色', problem: `去重色数实测 ${m.distinctColors}，${stage} 阶段应有 3 种以上主色`,
        reason: '无色彩分层时，光源方向与体积感都无法传达',
        fix: `按角色设定铺 3~4 个主色块（固有色/阴影/高光），先把主体明暗分开`,
        promptDraft: draft(meta, 'color', `去重色数实测 ${m.distinctColors}。请为画面建立 3~4 色基础配色：主体固有色、暗部、高光各一`),
      },
    );
  }

  // R4b color/detail 阶段整幅平涂：覆盖率≥90% 且色数≤2——用刷背景的方式骗不过覆盖率
  if ((stage === 'color' || stage === 'detail') && m.coverage >= 90 && m.distinctColors <= 2) {
    add(
      { kind: 'composition', severity: 'high', title: '整幅平涂（无构图）', detail: `覆盖率 ${m.coverage}% 但去重色数仅 ${m.distinctColors}——单一色块铺满画布，没有主体/背景的构图分层`, region: { x: 0.333, y: 0.333, w: 0.334, h: 0.334 } },
      {
        kind: 'composition', scope: 'global', severity: 'high',
        title: '建立主体与背景的分层', problem: `画面被单一色块覆盖（覆盖率 ${m.coverage}%、色数 ${m.distinctColors}），不构成可评估的构图`,
        reason: '涂满画布不等于画完：没有主体剪影与背景的区域分化，后续姿态/色彩/细化建议都无法锚定',
        fix: '先在中心格建立主体剪影（占 25%~40%），再用对比色区分背景与地面，覆盖率保持在 40%~70% 的构图合理区间',
        region: { x: 0.333, y: 0.333, w: 0.334, h: 0.334 },
        promptDraft: draft(meta, 'global', `实测覆盖率 ${m.coverage}% 但色数仅 ${m.distinctColors}，属整幅平涂。请重建画面分层：中心格主体剪影 + 背景对比色`),
      },
    );
  }

  // R5 单色占比>85% 且色数>3：色彩失衡
  if ((stage === 'color' || stage === 'detail') && m.distinctColors > 3 && m.palette[0] && m.palette[0].share > 85) {
    const [r, g, b] = m.palette[0].rgb;
    add(
      { kind: 'color', severity: 'low', title: '色彩失衡', detail: `主色 rgb(${r},${g},${b}) 占内容像素 ${m.palette[0].share}%（阈值 85%），而去重色数 ${m.distinctColors}，辅色存在感过弱` },
      {
        kind: 'color', scope: 'color', severity: 'low',
        title: '提高辅色占比', problem: `单一色相占 ${m.palette[0].share}%，画面近乎单色`,
        reason: '主色>85% 时冷暖对比与前后层次都读不出来',
        fix: '将阴影/背景切换到主色的互补或邻近色，把主色占比压到 70% 以下',
        promptDraft: draft(meta, 'color', `主色 rgb(${r},${g},${b}) 实测占 ${m.palette[0].share}%。请调整辅色配比，使主色占比降到 70% 以下`),
      },
    );
  }

  // R6 detail 阶段下 1/3 空白：背景缺失
  if (stage === 'detail' && m.bottomEmpty > 0.9) {
    const r: Region = { x: 0, y: +(2 / 3).toFixed(3), w: 1, h: +(1 / 3).toFixed(3) };
    add(
      { kind: 'background', severity: 'medium', title: '背景缺失', detail: `细化阶段实测下 1/3 空白占比 ${m.bottomEmpty}（阈值 0.9），画面贴地感不足`, region: r },
      {
        kind: 'background', scope: 'background', severity: 'medium',
        title: '补绘地面/背景', problem: `下 1/3 空白实测 ${m.bottomEmpty}，主体悬空`,
        reason: 'detail 阶段需要环境元素交代空间关系，否则主体像贴在白纸上',
        fix: '在下 1/3 铺地面投影与简单环境剪影，上 2/3 留弱渐变',
        region: r,
        promptDraft: draft(meta, 'background', `下 1/3 空白实测 ${m.bottomEmpty}。请仅在下 1/3 补绘地面/投影与简约背景剪影`),
      },
    );
  }

  // R7 主体偏小/姿态不完整
  const bboxArea = m.bbox ? m.bbox.w * m.bbox.h : 0;
  if (m.coverage > 8 && bboxArea < 0.15) {
    add(
      { kind: 'pose', severity: 'medium', title: '主体偏小/姿态不完整', detail: `主体包围盒仅占画面 ${(bboxArea * 100).toFixed(1)}%（阈值 15%），而覆盖率 ${m.coverage}% 说明笔触分散未成主体`, region: m.bbox ?? undefined },
      {
        kind: 'pose', scope: 'pose', severity: 'medium',
        title: '放大主体/收紧姿态', problem: `包围盒占画面 ${(bboxArea * 100).toFixed(1)}%，主体识别度不足`,
        reason: '主体过小会在后续上色/细化阶段丢失细节余量',
        fix: '整体放大主体约 1.3 倍或收紧四肢姿态，让包围盒达到画面 20% 以上',
        region: m.bbox ?? undefined,
        promptDraft: draft(meta, 'pose', `主体包围盒实测仅占画面 ${(bboxArea * 100).toFixed(1)}%（覆盖率 ${m.coverage}%）。请放大主体或调整姿态使包围盒≥20%`),
      },
    );
  }

  // R8 goal 一致性：结构信号推断（写明非语义理解）
  {
    const sev: Severity = meta.goal.trim().length < 6 ? 'medium' : 'low';
    const title = meta.goal.trim().length < 6 ? '画面目标描述过短' : '目标一致性待确认';
    add(
      {
        kind: 'goal', severity: sev, title,
        detail: `结构信号推断（非语义理解）：覆盖率 ${m.coverage}%、主体占画面 ${(bboxArea * 100).toFixed(1)}%、目标文本 ${meta.goal.trim().length} 字${meta.goal.trim().length < 6 ? '，不足以锚定画面方向' : ''}`,
      },
      {
        kind: 'goal', scope: 'global', severity: sev,
        title: meta.goal.trim().length < 6 ? '补充画面目标描述' : '对照目标自查画面',
        problem: meta.goal.trim().length < 6 ? `目标文本仅 ${meta.goal.trim().length} 字，评估缺少对齐锚点` : `目标文本 ${meta.goal.trim().length} 字，但当前结构信号（覆盖率 ${m.coverage}%、主体 ${(bboxArea * 100).toFixed(1)}%）只能做构图级核对`,
        reason: '目标越具体，后续生成任务的 scope 限定越准确，改动越可控',
        fix: meta.goal.trim().length < 6 ? '在项目设置中把目标补到 15 字以上（主体+动作+氛围）' : '确认画面主体与目标描述的主体/动作一致，不一致处回到对应阶段修正',
        promptDraft: draft(meta, 'global', `目标文本 ${meta.goal.trim().length} 字、实测覆盖率 ${m.coverage}%。请以目标为约束检查主体与动作方向是否一致，不一致仅做最小修正`),
      },
    );
  }

  // strengths：从实测挑 2 条正面事实（按固定优先级，保证确定性）
  const pool: string[] = [];
  if (m.coverage >= 5) pool.push(`覆盖率 ${m.coverage}%，画面信息量充足`);
  if (m.centroid && m.centroid.x >= 0.35 && m.centroid.x <= 0.65) pool.push(`质心 x=${m.centroid.x} 位于中心带，构图稳定`);
  if (m.distinctColors >= 3) pool.push(`去重色数 ${m.distinctColors}，色彩层次已建立`);
  if (m.edgeRatio >= 0.02) pool.push(`边缘密度 ${m.edgeRatio}，线条浓度达标`);
  if (strokes > 0) pool.push(`本段已落笔 ${strokes} 笔，有可分析的笔触数据`);
  if (bboxArea >= 0.15 && m.coverage > 2) pool.push(`主体占画面 ${(bboxArea * 100).toFixed(1)}%，尺度合理`);
  const strengths = (pool.length >= 2 ? pool : [...pool, '画布已建立，可进入下一轮绘制']).slice(0, 2);

  return { issues, suggestions, strengths, bboxArea };
}

export const mockProvider: AIProvider = {
  name: 'mock', mode: 'mock',

  async evaluate(input) {
    await new Promise(r => setTimeout(r, LATENCY()));
    const m = analyzePng(input.image);
    const { issues, suggestions, strengths, bboxArea } = evaluateRules(m, input.meta, input.stage, input.metrics.strokes);
    const score = computeScore(m, input.stage);
    const main = issues.filter(i => i.severity === 'high')[0] ?? issues[0];
    const core: EvaluationCore = {
      round: input.round, stage: input.stage, provider: 'mock', mode: 'mock',
      overall: {
        score,
        summary: `覆盖率 ${m.coverage}%、主体占画面 ${(bboxArea * 100).toFixed(1)}%、去重色数 ${m.distinctColors}、边缘密度 ${m.edgeRatio}。${main ? `主要问题：${main.title}。` : ''}数据来自服务端像素度量。`,
      },
      strengths, issues, suggestions,
    };
    return core;
  },

  async generate(input) {
    // mock 唯一失败路径：显式 simulateFail（用于演示失败/重试 UI）；路由层按契约等 800ms 后返回 502
    if (input.simulateFail) throw new Error('MOCK 模拟生成失败（演示失败路径）');
    await new Promise(r => setTimeout(r, LATENCY()));
    const { generateMockImage } = await import('./mockgen.js');
    const image = generateMockImage(input.image, input.scope, input.region);
    const keep = { pose: '轮廓与配色保持不变，仅位置/姿态变化', contour: '仅线条加粗，配色与构图不变', color: '轮廓与构图不变，仅色彩调整', background: '主体像素保持不变，仅空区补背景', local: '仅 region 内调整，区域外不变', global: '全图轻对比增强，主体结构不变' }[input.scope];
    return { image, note: `mock 图生图：${input.scope} 变换（${keep}）；右下角已叠加 MOCK·${input.scope}修正 半透明标签标识` };
  },
};
