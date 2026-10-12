// 与 design.md §2 完全一致的核心数据模型（字段名一个不差），前后端共用契约。

export type Stage = 'sketch' | 'lineart' | 'color' | 'detail';   // 草稿构图→线稿→上色→细化
export type Severity = 'high' | 'medium' | 'low';
export type IssueKind = 'composition' | 'consistency' | 'pose' | 'contour' | 'color' | 'background' | 'goal';
export type Scope = 'pose' | 'contour' | 'color' | 'background' | 'local' | 'global';

/** 归一化 0..1 的矩形区域 */
export interface Region { x: number; y: number; w: number; h: number; }

export interface ProjectMeta {
  id: string; title: string; theme: string;       // 动画主题
  character: string;                               // 角色设定
  goal: string;                                    // 画面目标
  createdAt: number;
}

export interface Issue { id: string; kind: IssueKind; severity: Severity; title: string; detail: string; region?: Region; }

export interface Suggestion {
  id: string; basedOnIssue?: string;
  kind: IssueKind; scope: Scope; severity: Severity;
  title: string; problem: string; reason: string; fix: string;   // 具体问题/修改理由/可执行建议
  region?: Region;
  promptDraft: string;        // 生成任务提示词草稿（含度量数字，禁止空话）
}

export interface Evaluation {
  id: string; round: number; stage: Stage; provider: string; mode: 'mock' | 'real'; latencyMs: number;
  overall: { score: number; summary: string };     // score 0..100
  strengths: string[];
  issues: Issue[];
  suggestions: Suggestion[];
}

export interface Generation {
  id: string; round: number; suggestionId?: string; scope: Scope;
  prompt: string;                     // 实际发送的最终 prompt（用户可改过）
  provider: string; mode: 'mock' | 'real'; latencyMs: number;
  image: string;                      // PNG dataURL
  note: string;                       // 是否图生图/局部重绘、保留性说明
}

/** image=PNG dataURL 全幅；thumb=宽240 缩略图（见 SELFREPORT 偏离项：缩略图为 PNG 而非 JPEG） */
export interface Snapshot { id: string; round: number; stage: Stage; image: string; thumb: string; createdAt: number; label: string; }

export interface RoundRecord { round: number; stage: Stage; evaluationId?: string; generationIds: string[]; decisions: { type: 'accept'|'reject'|'adjust'|'adopt'|'restore'; targetId: string; note?: string; at: number }[]; }

export interface ProjectDoc { meta: ProjectMeta; stage: Stage; round: number; rev: number; snapshots: Snapshot[]; evaluations: Evaluation[]; generations: Generation[]; rounds: RoundRecord[]; }
