# StepFun 后端接入

本文记录 2026-07-24 核对过的官方协议事实和 Lemma 的后端边界。来源：

- [Realtime 开发指南](https://platform.stepfun.com/docs/zh/guides/developer/realtime)
- [双向实时语音 API](https://platform.stepfun.com/docs/zh/api-reference/realtime/chat)
- [Step Plan 语音模型接入](https://platform.stepfun.com/docs/zh/step-plan/integrations/audio-api)
- [官方 Realtime Console](https://github.com/stepfun-ai/Step-Realtime-Console)

Lemma 主线的 StepFun 集成**仅**包含 Realtime 语音代理。文本与结构化 AI 调用走 DeepSeek（`DEEPSEEK_API_KEY` / `AI_ROUTES_JSON`）。

## Realtime 安全边界

Step Plan 实时语音端点是
`wss://api.stepfun.com/step_plan/v1/realtime?model=stepaudio-2.5-realtime`，
握手必须携带 `Authorization: Bearer STEP_API_KEY`。官方资料没有提供可下发给
浏览器的临时凭据端点；官方 Console 也明确采用服务端 WebSocket 中转。因此
Lemma 只提供后端长连接代理，任何响应都不会包含 StepFun API key。

后端代理为 `WS /api/v1/realtime/voice`：

1. 浏览器使用与 `CORS_ORIGINS` 一致的 Origin 建立 `wss://` 连接。
2. 连接后 5 秒内，第一帧必须是 Lemma 控制事件：

   ```json
   {"type":"proxy.auth","accessToken":"<Supabase user access token>"}
   ```

   token 使用与 HTTP API 相同的 issuer、audience、签名和过期时间校验；不要
   放在 URL query 中，避免被代理访问日志记录。
3. 鉴权成功且上游连接完成后，后端返回：

   ```json
   {
     "type":"proxy.ready",
     "model":"stepaudio-2.5-realtime",
     "audioFormat":"pcm16",
     "sampleRateHz":24000,
     "frameDurationMs":30,
     "serverVad":true,
     "maxSessionSeconds":1800
   }
   ```

4. 后端自动向 StepFun 发送默认 `session.update`。浏览器随后会收到原样转发的
   `session.created` 和 `session.updated`；收到 `session.updated` 后再开始推流。
5. 允许浏览器发送的官方 Client Event 只有：
   - `session.update`：仅允许 modalities、instructions、voice、pcm16 格式和
     Server VAD 参数；不允许 tools。
   - `input_audio_buffer.append`：`audio` 为 Base64、16 位有符号小端 PCM；
     字节数必须为偶数，单帧解码后不超过 512 KiB。前端固定重采样为单声道
     24000 Hz，并按 30 ms（720 samples / 1440 bytes）发送。官方建议
     20–30 ms 小块且上限为 15 MB，代理使用更低上限控制内存和滥用。
   - `input_audio_buffer.commit`、`input_audio_buffer.clear`
   - `response.create`、`response.cancel`
6. 默认启用 Server VAD，只需连续发送 `input_audio_buffer.append`。按键说话模式
   先用 `session.update` 将 `turn_detection` 设为 `null`，结束时依次发送
   `input_audio_buffer.commit` 和 `response.create`。
7. StepFun Server Event 保持官方 JSON 形状原样转发。前端重点处理：
   - `input_audio_buffer.speech_started` / `speech_stopped`
   - `conversation.item.input_audio_transcription.delta`：按 `item_id` /
     `content_index` 累积 `delta`
   - `conversation.item.input_audio_transcription.completed`
   - `response.audio.delta`：`delta` 为 Base64 PCM16 音频字节
   - `response.audio_transcript.delta` / `done`
   - `response.text.delta` / `done`
   - `response.thinking.delta` / `done`
   - `response.audio.done`、`response.done`、`error`

官方网页播放示例将输出 PCM16 按小端、有符号、单声道 24000 Hz 播放；API 字段
本身只声明 `pcm16`。前端应按该官方示例参数实现流式播放器，并支持在打断时立即
清空播放缓冲区。

代理额外限制每用户每进程最多 2 条连接、每条最长 1800 秒、每个 JSON 帧最多
1 MiB，并校验 Origin。`proxy.error` 是 Lemma 控制事件；其稳定 code 包括
`invalid_auth`、`auth_timeout`、`auth_unavailable`、`too_many_sessions`、
`invalid_event`、`session_expired`、`provider_not_configured` 和
`upstream_unavailable`；Origin 被拒绝时为 `origin_not_allowed`。代理会先发送
`proxy.error`，再使用对应的稳定 WebSocket close code 关闭连接。

## 环境变量

见 `backend/.env.example`：

- `STEPFUN_API_KEY` — Realtime 上游鉴权（服务端 only）
- `STEPFUN_REALTIME_*` — 模型、voice、指令与代理限额
