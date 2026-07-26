# HUD 卡片流对接文档(Rokid Glasses × Lemma 后端)

面向 `rokid-android/RokidProject`(纯 Java、CXR-L SDK `com.rokid.cxr:client-l:1.0.3`)的
手机端对接指南。手机 App 是 HUD 的唯一中转:**眼镜不直连后端**,SSE 终止在手机,
由 CXR CustomView 通道把短文本转发到眼镜。

```
后端 /api/v1/hud/stream ──SSE──> 手机 App(HudFeedManager)──CXR customViewUpdate──> 眼镜 HUD
```

## 1. 鉴权:两套独立凭证,不可混用

| 凭证 | 用途 | 来源 |
|---|---|---|
| Rokid 授权 token | `CXRLink.connect(token)` 连眼镜 | Rokid AI App 授权页(现有流程,不变) |
| Supabase access token | 后端 API 的 `Authorization: Bearer` | Supabase Auth 登录 |

获取 Supabase token(密码登录,`SUPABASE_URL` 见 backend/.env):

```
POST {SUPABASE_URL}/auth/v1/token?grant_type=password
apikey: <publishable key>          # 前端 .env 的 VITE_SUPABASE_PUBLISHABLE_KEY
Content-Type: application/json

{"email": "...", "password": "..."}
```

响应里的 `access_token` 即 Bearer;`expires_in` 通常 3600 秒,过期用
`grant_type=refresh_token` 换新。**注意:token 过期会导致 SSE 断连(401),重连前先刷新。**

## 2. 连接

```
GET http://<后端主机>:18473/api/v1/hud/stream
Authorization: Bearer <supabase access token>
Accept: text/event-stream
```

- 真机调试时后端 `API_HOST` 需绑定局域网地址(默认 `127.0.0.1` 只能本机访问),
  且手机与后端同一网段
- Android 侧用 OkHttp(`com.squareup.okhttp3:okhttp-sse`),或裸 OkHttp 拿
  `ResponseBody.source()` 按行读;OkHttp 请求头无浏览器 EventSource 限制
- **`app/src/main/AndroidManifest.xml` 需补 `<uses-permission android:name="android.permission.INTERNET"/>`**
  (当前 manifest 只有 CXR 相关权限);明文 http 还需 `android:usesCleartextTraffic="true"`
  或 networkSecurityConfig

## 3. SSE 事件协议

连接建立先收一次全量 `snapshot`,之后是增量 `card` 和保活 `heartbeat`:

```
event: snapshot
data: {"cards":[{...}],"generatedAt":"2026-07-25T12:00:00+00:00"}

event: card
data: {"id":"task:6f0e...","kind":"agent_progress","priority":"urgent","title":"等待你确认","body":"关税保单研究","ts":"2026-07-25T12:00:20+00:00","ttlSeconds":120,"ref":{"type":"agent_task","id":"6f0e..."}}

event: heartbeat
data: {"ts":"2026-07-25T12:00:15+00:00"}

event: error
data: {"code":"...","message":"..."}
```

### 卡片字段

| 字段 | 说明 |
|---|---|
| `id` | 去重键。收到同 `id` 的 `card` 事件 → 原地覆盖 |
| `kind` | `world_signal` 世界情报 / `watch_due` 盯盘到期 / `agent_progress` Agent 进度 / `policy_status` 保单状态 |
| `priority` | `urgent` > `high` > `normal` > `low` |
| `title` | ≤24 字符,HUD 单行(服务端已按 16sp 视图宽度截断) |
| `body` | ≤60 字符,HUD 两行以内 |
| `ttlSeconds` | 收到后经过该秒数未被更新 → 客户端自行消隐 |
| `ref` | 可选深链 `{type, id}`,仅手机端使用,不上 HUD |

### 渲染建议(映射到现有 CXR 代码)

- `urgent` / `high`:立即 `DisplayCapabilityManager.updateText()` 弹现,停留 ≥5s
- `normal` / `low`:进轮播队列,按 priority 排序,每张 5-8s 轮转
- HUD 单文本节点显示:`title + "\n" + body` 拼接后传给 `updateText`
- 推送前置条件(沿用现有状态机):链路双条件就绪 **且** `onCustomViewOpened` 已收到
  (`DisplayCapabilityManager.isSceneOpened()`)

### 重连语义

卡片是瞬态的,**没有 Last-Event-ID 回放**:

1. 断线(含 `heartbeat` 超过 45s 未到)→ 指数退避重连(1s、2s、4s…上限 30s)
2. 重连成功 → 清空本地卡片缓存,直接吃新 `snapshot`
3. 收到 401 → 先刷新 Supabase token 再重连

## 4. 手机端骨架建议(HudFeedManager)

与现有 Capability Manager 同风格的单例,伪代码:

```java
public final class HudFeedManager {
    private static volatile HudFeedManager sInstance;
    private final OkHttpClient client = new OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.SECONDS)   // SSE 长连接不设读超时
            .build();
    private final Map<String, HudCard> cards = new ConcurrentHashMap<>();

    public void start(String baseUrl, String supabaseToken) {
        Request request = new Request.Builder()
                .url(baseUrl + "/api/v1/hud/stream")
                .header("Authorization", "Bearer " + supabaseToken)
                .header("Accept", "text/event-stream")
                .build();
        EventSources.createFactory(client).newEventSource(request, new EventSourceListener() {
            @Override public void onEvent(EventSource s, String id, String type, String data) {
                switch (type) {
                    case "snapshot": replaceAll(parseSnapshot(data)); break;
                    case "card":     upsert(parseCard(data)); break;
                    case "heartbeat": touchLiveness(); break;
                }
                renderNext();   // 按 priority 取一张 → DisplayCapabilityManager.updateText
            }
            @Override public void onFailure(EventSource s, Throwable t, Response r) {
                scheduleReconnect();   // 指数退避; 401 先刷 token
            }
        });
    }
}
```

依赖(app/build.gradle):

```groovy
implementation 'com.squareup.okhttp3:okhttp:4.12.0'
implementation 'com.squareup.okhttp3:okhttp-sse:4.12.0'
implementation 'com.google.code.gson:gson:2.10.1'
```

## 5. 验证

后端启动(backend/ 目录):`uv run uvicorn main:app --host 0.0.0.0 --port 18473`

curl 观察事件流(`-N` 关闭缓冲):

```bash
curl -N -H "Authorization: Bearer <token>" http://127.0.0.1:18473/api/v1/hud/stream
```

离线冒烟(绕过 HTTP 鉴权,直测聚合服务):

```bash
uv run python scripts/smoke_hud_stream.py
```

## 6. 服务端行为参考

- 轮询节奏 `HUD_POLL_INTERVAL_SECONDS`(默认 20s)、心跳 `HUD_HEARTBEAT_INTERVAL_SECONDS`
  (默认 15s)、卡片上限 `HUD_MAX_CARDS`(默认 30),均可在 backend/.env 覆盖
- 四个数据源任一失败只丢该源本轮数据,流不中断
- 内容未变化的卡片不会重复推送(服务端指纹差分,`ts` 变化不算内容变化)
- 协议契约源码:`schemas/hud.py`;聚合逻辑:`services/hud_feed_service.py`
