# TASK 2D 真实 AI Provider 自检报告（Wave 2D）

环境：Node v22.23.1 / npm 10.9.8 / macOS（设计书写 Node 24，本机为 22 —— `fetch/FormData/Blob/Response/AbortController` 自 Node 18 起全部原生内置，无兼容差异）。契约：`../design.md` §4 §5 §6 §8 §10。全部命令真实执行。

## 1. 测试命令与结果

```
cd server && npm test        # 全部测试（含 Wave 1A 原有 29 例）仍绿
# tests 36
# pass 36
# fail 0
# duration_ms 1262

npm run build                # tsc（NodeNext/strict，含测试文件）零错误
```

`src/tests/real.test.ts` 新增 7 例（node:test，monkey-patch `globalThis.fetch`，`t.mock.method` 自动还原，全程 stub、零真实网络）：

```
ok 30 - ① chat 成功返回合法 JSON → 请求形状正确 + Evaluation 映射正确
ok 31 - ② chat 返回 markdown 围栏 JSON（纯围栏 / 围栏+前后噪声）→ 仍解析成功
ok 32 - ③ chat 超时（fetch 永挂 + 注入 40ms 短超时）→ 抛可重试错误
ok 33 - ④ IMG_EDIT_MODE=edits → multipart images/edits，b64 响应正确解回 Buffer
ok 34 - ⑤ HTTP 401（key 无效）→ 抛不可重试错误（evaluate 与 generate 同判）
ok 35 - ⑥ 缺省（IMG_EDIT_MODE 未设）→ images/generations 文生图，note 写明保留性限制
ok 36 - ⑦ chat 文本不含 JSON → 解析失败抛可重试错误
```

覆盖细节（对应任务书 5 类 + 2 条契约强化）：

- **①**：断言请求形状（`{LLM_BASE_URL}/chat/completions`、`Authorization: Bearer`、`model=LLM_MODEL`、`response_format:{type:'json_object'}`、system 为 color 阶段模板组合「一致性审核员+上色师+监督」、user 为多模态数组——text 块含 character/goal 与 analyzer 实测数字、image_url 块为 `data:image/png;base64` 前缀）；断言映射（provider/mode='real'、round/stage 回显、score 73.6→74、`iss-N`/`sug-N` 补 id、`basedOnIssue:1→iss-1`、非法 scope→`global` 回退、region 越界(x=9)→undefined、空 promptDraft→默认文案）
- **②**：纯 ```` ```json ```` 围栏（剥围栏路径）与「好的，评估如下：…围栏…以上。」（截首个 `{` 到末个 `}` 路径）均解析成功
- **③**：fetch stub 返回永不 settle 的 Promise，`createRealProvider({timeoutMs:40})` 注入短超时 → `RealProviderError` 且 `retryable===true`（超时靠 provider 自管计时器触发，不依赖 fetch 的 signal 语义，故 stub 永挂也能触发）
- **④**：断言 multipart 形状（`{IMG_BASE_URL}/images/edits`、`FormData` 字段 model/prompt/size=`480x300`、image 为 `image/png` Blob 且字节与输入画布逐字节相等、鉴权头）；b64 响应 → `Buffer` 与原图往返一致；note 写明图生图与底图
- **⑤**：401 + `error.message` → `retryable===false`（evaluate 与 generate 两路同判）
- **⑥**：缺省分支走 `images/generations`（JSON body：model/prompt/size），note 含任务书原句「文生图模式：无法保证保留原图内容，仅供方向参考」
- **⑦**：纯文本无 JSON → 抛可重试解析错误

## 2. provider.ts 接线验证（零改动即生效）

Wave 1A 的动态 import 探测设计成立，**本波未改 provider.ts 任何一行**。真实执行（假 key、无网络调用，仅验证选择逻辑）：

```
$ AI_PROVIDER=real LLM_API_KEY=dummy-key IMG_API_KEY=dummy-key LLM_MODEL=test-llm IMG_MODEL=test-img \
  node --import tsx -e "import('./src/ai/provider.ts').then(async m => { const {provider, config} = await m.getProvider(); console.log(provider.name, provider.mode, JSON.stringify(config)); })"
provider = real / real
config   = {"mode":"real","hasLlmKey":true,"hasImgKey":true,"llmModel":"test-llm","imgModel":"test-img","mockNote":"真实模型模式"}
```

无 key / 未设 `AI_PROVIDER=real` 时照旧回落 mock（Wave 1A 行为，原有 api.test.ts 第 7 例仍绿）。未做真实 key 冒烟（按任务书：PM 决定，本代理无 key 也不去找）。

## 3. env 变量表（key 只从服务端 env 读，绝不写死、绝不回传前端）

| 变量 | 作用 | 缺省兜底 |
|---|---|---|
| `AI_PROVIDER` | `=real` 时启用真实 provider（provider.ts 判定，需两把 key 齐备） | mock |
| `LLM_API_KEY` | chat/completions 的 Bearer key | 无（仅 `AI_PROVIDER=real` 判定用到，缺则回落 mock） |
| `LLM_BASE_URL` | LLM OpenAI 兼容基地址 | `https://api.openai.com/v1` |
| `LLM_MODEL` | 聊天模型名 | `gpt-4o-mini`（需支持图片输入 + json_object） |
| `IMG_API_KEY` | images/edits、images/generations 的 Bearer key | 同 LLM_API_KEY 说明 |
| `IMG_BASE_URL` | 图像 OpenAI 兼容基地址 | `https://api.openai.com/v1` |
| `IMG_MODEL` | 图像模型名 | `gpt-image-1` |
| `IMG_EDIT_MODE` | `=edits` 走图生图 `images/edits`（multipart，底图=当前画布）；**其它/缺省走文生图** `images/generations`，note 如实写明保留性限制 | 文生图 |
| `MOCK_LATENCY_MS` | （mock 用，与本波无关） | 600 |

非 env 的实现参数：单请求超时 60_000ms（与路由层 `REQUEST_TIMEOUT_MS` 对齐，§8），测试可经 `createRealProvider({timeoutMs})` 注入。

## 4. 偏离项与说明（对 design.md / 任务书）

1. **「latencyMs 实测」由路由层完成**：`AIProvider.evaluate` 契约返回 `Evaluation 去掉 id/latency 的部分`，app.ts 在调用前后计时并补齐（`app.ts:138`）。real.ts 无法也不应填写该字段——属契约内分工，非偏离。
2. **「不可重试」只到 provider 层，HTTP 层目前一律 `retryable:true`**：app.ts（Wave 1A，非本波所有权）把所有非 HttpError 的 provider 异常统一映射为 `502 {retryable:true}`，且 `HttpError` 未导出、real.ts 无法抛它。故 401/400 等配置类错误在本波只能做到「provider 层抛 `RealProviderError.retryable===false`」（测试 ⑤ 验证即此）。若 PM 希望前端区分，需后续波次在 app.ts 识别 `retryable` 属性——一行改动，本波未越权去改。
3. **「非纯文本生成」的解读**：generate 入参恒含 `image: Buffer`，本 provider 的 generate 全部是图像任务；「纯文本生成」即 `IMG_EDIT_MODE≠edits` 时的文生图兜底分支（该分支 note 按任务书写明保留性限制）。即：分支条件实际为 `IMG_EDIT_MODE==='edits'`。
4. **`size: '480x300'`**（两分支均发）：任务书明确指定；注意官方 OpenAI 的 dall-e/gpt-image 只接受固定档位（如 1024x1024），该值面向「OpenAI 兼容」代理端点。若端点拒绝会得到 400 不可重试错误（信息完整、可定位）。
5. **模型输出非 PNG 时不转码、在 note 里如实声明**：依赖白名单内无 JPEG/WebP 编码器，无法重编码；按 §10 诚实性红线，note 追加「模型输出经魔数检测不是 PNG，已按契约原样封装展示」，而不是谎称 PNG。
6. **basedOnIssue 允许模型回 1 基序号**（提示词约定），映射为补齐后的 `iss-N`；对不上则留 undefined。契约未定义 LLM 如何引用 issue id，此为最小可解释方案。
7. **图片响应兼容 `b64_json` 与 `url` 两种形态**（dall-e 系默认回 url）：下载 url 时**不带 Authorization 头**（预签名 url 属第三方域，带 key 请求等于外泄 key）。任务书只要求 b64_json，此为防御性兼容。
8. **local scope 的 region 坐标拼进出图 prompt**：OpenAI images 接口无 region 参数，归一化坐标以文本形式随 prompt 发送（测试 ④ 断言）。 Generation.prompt 字段落盘的仍是用户原始 prompt（路由层行为），附加行只出现在发往模型的请求里。
9. **新增 `createRealProvider(opts)` 工厂 + `realProvider` 默认实例**：工厂仅为注入测试超时所需，`provider.ts` 动态 import 取的是 `realProvider`。

无其他偏离。key 零硬编码、零日志输出、零回传前端；所有失败路径（超时/网络/解析/非 2xx）均有对应测试或结构化错误覆盖。
