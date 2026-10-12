// projects.json 单文件持久化（design.md §1）：内存立即生效 + 300ms 防抖原子落盘（tmp+rename）。
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectDoc } from './types.js';

const MAX_SNAPSHOTS = 30;      // 全幅快照上限（thumb 不限）
const SAVE_DEBOUNCE_MS = 300;

/** 快照超限淘汰最旧的非当前（当前=最新一条，恢复操作以新增快照实现，故恒为数组末位） */
function trimSnapshots(doc: ProjectDoc) {
  if (doc.snapshots.length > MAX_SNAPSHOTS) doc.snapshots = doc.snapshots.slice(-MAX_SNAPSHOTS);
}

export class Store {
  private file: string;
  private docs = new Map<string, ProjectDoc>();
  private timer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'projects.json');
    this.load();
  }

  /** 启动加载：文件不存在或损坏时从空库开始（首次运行/可丢弃损坏文件） */
  private load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      for (const doc of JSON.parse(raw) as ProjectDoc[]) this.docs.set(doc.meta.id, doc);
    } catch { /* 无文件或损坏 → 空库 */ }
  }

  get(id: string): ProjectDoc | undefined { return this.docs.get(id); }

  put(doc: ProjectDoc) {
    trimSnapshots(doc);
    this.docs.set(doc.meta.id, doc);
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, SAVE_DEBOUNCE_MS);
    // 防抖定时器不阻止进程退出（退出前由 flushSync 兜底）
    this.timer.unref?.();
  }

  /** 原子写：先写 tmp 再 rename，读方永远不会看到半截 JSON */
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...this.docs.values()]));
    fs.renameSync(tmp, this.file);
  }
}
