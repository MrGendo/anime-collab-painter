# TASK 2D — 真实 AI Provider（Wave 2）

你是本项目的真实模型接入代理。契约：`../design.md`（先完整读 §4 §5 §6 §8 §10）。上一波已交付 `server/`（含 provider.ts 接口与 mock 实现，必读 `server/src/ai/provider.ts`）。

## 所有权（严格）

- 只允许创建/修改：`server/src/ai/real.ts`、`server/src/tests/real.test.ts`、`server/SELFREPORT-2D.md`
- 禁止修改：server 其他文件（发现接口对不上就在报告里写偏离项，最多允许在 provider.ts 的选择逻辑处做**最小**接线修改，其余不动）、web/、git

## 交付内容

1. `real.ts` 实现 AIProvider（OpenAI 兼容协议，纯 fetch，不加依赖）：
   - evaluate：POST {LLM_BASE_URL}/chat/completions，model=LLM_MODEL，多模态消息（system=评估模板按 stage 组合自 prompts.ts；user 含 goal/character/stage 文本 + image dataURL content 块）；response_format json_object；拿到文本后**健壮解析**（剥 markdown 围栏、截取首个 { 到末个 }、失败抛可重试错误）；把 JSON 映射为 Evaluation 结构（缺字段给默认、issues/suggestions 补 id、region 缺省 undefined）；latencyMs 实测
   - generate：POST {IMG_BASE_URL}/images/edits 若 env IMG_EDIT_MODE=edits 且非纯文本生成（multipart：image 文件 + prompt + size 480x300）——实现 OpenAI images/edits 格式（FormData + Blob，Node 24 原生支持）；否则 images/generations（文生图，note 必须写明「文生图模式：无法保证保留原图内容，仅供方向参考」）
   - key 只从 env 读，绝不写死、绝不回传前端
2. `server/src/tests/real.test.ts`：monkey-patch global fetch stub 覆盖：①chat 成功返回合法 JSON → Evaluation 映射正确 ②chat 返回 markdown 围栏 JSON → 仍解析成功 ③chat 超时（stub 永挂 + AbortController 短超时注入）→ 抛 retryable ④edits 成功返回 b64 → Buffer 正确 ⑤HTTP 401 → 抛不可重试错误。测试不得真发网络
3. `server/SELFREPORT-2D.md`：测试输出、env 变量表、偏离项

## 自验

```
cd server && npm test   # 全部测试（含原有）仍绿
```

## 完成标志

npm test 全绿（含你新增的 5 类用例）+ SELFREPORT-2D.md。不要求真 key 实测（PM 决定是否用真实 key 冒烟，你没 key 也不许找）。
