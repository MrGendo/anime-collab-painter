# TASK 1A — 后端实现（Wave 1）

你是本项目的后端实现代理。唯一契约：`../design.md`（先完整读它）。本文件是你的任务边界。

## 所有权（严格）

- 只允许创建/修改：`server/**`、`server/data/.gitkeep`
- 禁止触碰：`web/`、`design.md`、`TASKS/`、`logs/`、`README.md`、git 任何操作（PM 负责 commit）
- 若发现契约有误/无法实现，照最合理方式实现并在报告「偏离项」中写明，不要停下来问

## 交付内容

在 `server/` 实现完整后端（design.md §1 目录、§2 类型、§3 API、§4 Provider、§5 Mock、§6 Prompt 模板、§8 失败规范）：

1. `package.json`：name=collab-paint-server，type=module，scripts: dev=tsx watch src/index.ts, build=tsc, start=node dist/index.js, test=node --import tsx --test src/tests/*.test.ts。依赖仅：express cors pngjs；devDeps：typescript tsx @types/express @types/cors @types/node @types/pngjs
2. `src/types.ts` 与 design.md §2 完全一致（字段名一个不差）
3. `src/analyzer`（在 ai/analyzer.ts）：pngjs 解码 → coverage/bbox质心/grid3x3/paletteTop6/edgeRatio/bottomEmpty 等度量，纯函数可测
4. `src/ai/mock.ts` + `ai/mockgen.ts`：按 design.md §5 规则表实现。硬性要求：
   - 全部确定性（禁 Math.random / Date.now 参与内容生成）；延迟用 MOCK_LATENCY_MS（默认 600）
   - evaluation 的每条 issue/suggestion 必须引用实测数字（如覆盖率、象限占比、色数）
   - promptDraft 含实测数字 + character/goal 摘要 + scope 限定语
   - mockgen 按 scope 做真实像素变换 + 右下角半透明 `MOCK·<scope>修正` 标签（PNG 合成，文字可用简单 5x7 点阵字模，不必字体库）
   - overall.score 公式写注释
5. `src/prompts.ts`：模板注册表（8 个模板名见 §6），evaluate 与 generate 各自的模板选择逻辑；`/api/prompt/build` 用它
6. `src/store.ts`：projects.json 原子持久化（tmp+rename、300ms 防抖、启动加载、snapshots 上限 30 全幅淘汰最旧）
7. `src/index.ts`：Express 全部路由（§3）+ 60s 超时中间件 + 错误处理（502 结构 {error,retryable}）+ 生产模式托管 ../web/dist（catch-all 放最后 + 目录穿越防护，绝不影响 /api）+ PORT=8903
8. `src/ai/provider.ts`：AIProvider 接口 + 选择逻辑（AI_PROVIDER=real 且 key 齐才 real，否则 mock 并在 /api/config 如实报告；Wave 2D 才有 real.ts，本期 real 分支直接抛 Not Implemented 并回落 mock）
9. 测试 `src/tests/`（node:test + tsx，直接 import app 或 supertest 风格自选，至少覆盖）：
   - analyzer：合成 PNG（测试里用 pngjs 现画）验证 coverage/bbox/空格判定数字正确
   - mock.evaluate：空白画布→有"画布几乎为空" high issue；左半内容→构图失衡 issue 且 region 在右侧；确定性（两次调用 JSON 相等）
   - mockgen：每个 scope 输出合法 PNG（pngjs 能解回）且与输入尺寸一致、与输入像素不同
   - API 冒烟：health/config/建项目/evaluate/prompt build/generate/simulateFail=502/PUT doc rev 递增
10. 自测通过后写 `server/SELFREPORT.md`：测试命令与输出摘要、curl 冒烟结果、偏离项清单

## 自验命令（必须真实跑过并把输出贴进 SELFREPORT）

```
cd server && npm install && npm test
PORT=8903 npm run dev   # 另开终端 curl 冒烟
```

## 完成标志

npm test 全绿 + SELFREPORT.md 存在且含真实输出。报告里写清每个文件的作用（一行一个）。
