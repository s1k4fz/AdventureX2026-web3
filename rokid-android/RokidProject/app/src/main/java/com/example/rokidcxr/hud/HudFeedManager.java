package com.example.rokidcxr.hud;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.example.rokidcxr.sdk.capability.BaseCapabilityManager;
import com.example.rokidcxr.sdk.capability.DisplayCapabilityManager;
import com.example.rokidcxr.sdk.capability.StatusCapabilityManager;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;

/**
 * HUD 卡片流 Manager（单例）：接收后端 SSE 聚合流并轮播到眼镜 HUD。
 *
 * 数据链路（backend/HUD.md）：
 *   后端 /api/v1/hud/stream ──SSE──> 本 Manager ──DisplayCapabilityManager.updateText──> 眼镜
 *
 * 协议要点：
 * 1. 连接即收全量 snapshot；card 事件按 id 原地覆盖；heartbeat 约 15s 一次
 * 2. 卡片瞬态、无 Last-Event-ID 回放：重连后清空本地缓存直接吃新 snapshot
 * 3. urgent/high 到达立即弹现；normal/low 进轮播队列（优先级排序，8s 轮转）
 * 4. heartbeat 超 45s 未到 → 判定断线，指数退避重连（1s 起，30s 封顶）
 * 5. HTTP 401 → 回调 onAuthError，由 UI 层刷新 Supabase token 后重新 start
 *
 * 渲染前置条件沿用现有状态机：链路双条件就绪 且 onCustomViewOpened 已收到
 * （DisplayCapabilityManager.isSceneOpened()）；未就绪时卡片只入队不上屏。
 */
public final class HudFeedManager {

    private static final String TAG = "HudFeedManager";

    private static final long ROTATE_INTERVAL_MS = 8_000L;
    /** 中央滚动字幕：每拍上移一行，3 行窗口；单帧 <100B，带宽无压力 */
    private static final long TICKER_INTERVAL_MS = 700L;
    private static final int TICKER_WINDOW = 3;
    /** 16sp 下可视区（~310dp）每行约 18 个中文字符，超长切块防折行 */
    private static final int TICKER_LINE_CHARS = 18;
    /** urgent 弹现后滚动暂停时长，保证用户看清提醒 */
    private static final long URGENT_HOLD_MS = 5_000L;
    private static final long LIVENESS_TIMEOUT_MS = 45_000L;
    private static final long LIVENESS_CHECK_MS = 15_000L;
    private static final long RECONNECT_BASE_MS = 1_000L;
    private static final long RECONNECT_MAX_MS = 30_000L;

    /** 流状态回调（主线程触发），面向 UI 日志/token 刷新 */
    public interface FeedListener {
        void onFeedConnected();

        void onFeedDisconnected(String reason);

        /** 401：Supabase token 失效，刷新后重新 start() */
        void onAuthError();

        void onCardShown(HudCard card);
    }

    private static volatile HudFeedManager sInstance;

    public static HudFeedManager getInstance() {
        if (sInstance == null) {
            synchronized (HudFeedManager.class) {
                if (sInstance == null) {
                    sInstance = new HudFeedManager();
                }
            }
        }
        return sInstance;
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Gson gson = new Gson();
    // SSE 长连接：读超时必须为 0，否则 heartbeat 间隔会触发 SocketTimeout
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .build();

    /** id -> 卡片，snapshot 整体替换、card 事件单点覆盖 */
    private final Map<String, HudCard> cards = new ConcurrentHashMap<>();

    private String baseUrl;
    private String bearerToken;
    private FeedListener listener;
    private EventSource eventSource;
    private volatile boolean running = false;
    /** 为 true 时卡片不上屏（地球动画等占屏演示中），队列与 SSE 照常维护 */
    private volatile boolean renderPaused = false;
    private volatile long lastEventAtMs = 0L;
    private int reconnectAttempts = 0;
    /** 底部预测区独立轮播游标 */
    private int predIndex = 0;
    /** 分区上次内容，避免每拍重发相同文本 */
    private String lastRiskText = "";
    private String lastPredText = "";
    // 中央滚动字幕状态（全部主线程访问）
    private final List<String> tickerLines = new ArrayList<>();
    private int tickerIndex = 0;
    private String lastCenterText = "";
    private long urgentHoldUntilMs = 0L;

    private HudFeedManager() {
    }

    /**
     * 启动卡片流。重复调用会先停旧连接（幂等）。
     *
     * @param baseUrl 形如 http://192.168.1.10:18473（不带路径）
     * @param supabaseAccessToken Supabase 登录后的 access_token（与 Rokid 授权 token 无关）
     */
    public void start(String baseUrl, String supabaseAccessToken, FeedListener listener) {
        stop();
        this.baseUrl = baseUrl;
        this.bearerToken = supabaseAccessToken;
        this.listener = listener;
        this.running = true;
        this.reconnectAttempts = 0;
        // 启动状态监听（蓝牙+电池）
        StatusCapabilityManager.getInstance().start();
        connect();
        mainHandler.postDelayed(rotateRunnable, ROTATE_INTERVAL_MS);
        mainHandler.postDelayed(tickerRunnable, TICKER_INTERVAL_MS);
        mainHandler.postDelayed(livenessRunnable, LIVENESS_CHECK_MS);
        Log.i(TAG, "start: " + baseUrl + "/api/v1/hud/stream");
    }

    /** 停止卡片流并清空本地缓存（不动眼镜端已显示内容） */
    public void stop() {
        running = false;
        mainHandler.removeCallbacks(rotateRunnable);
        mainHandler.removeCallbacks(tickerRunnable);
        mainHandler.removeCallbacks(livenessRunnable);
        mainHandler.removeCallbacks(reconnectRunnable);
        if (eventSource != null) {
            eventSource.cancel();
            eventSource = null;
        }
        cards.clear();
        tickerLines.clear();
        tickerIndex = 0;
        lastCenterText = "";
        // 停止状态监听
        StatusCapabilityManager.getInstance().stop();
    }

    public boolean isRunning() {
        return running;
    }

    public int getCardCount() {
        return cards.size();
    }

    /** 暂停/恢复卡片上屏（不断流、不清队列）；地球动画等占屏场景用 */
    public void setRenderPaused(boolean paused) {
        this.renderPaused = paused;
    }

    // ===== SSE 连接 =====

    private void connect() {
        Request request = new Request.Builder()
                .url(baseUrl + "/api/v1/hud/stream")
                .header("Authorization", "Bearer " + bearerToken)
                .header("Accept", "text/event-stream")
                .build();
        eventSource = EventSources.createFactory(client)
                .newEventSource(request, new EventSourceListener() {
                    @Override
                    public void onOpen(EventSource source, Response response) {
                        Log.i(TAG, "SSE 已连接");
                        lastEventAtMs = System.currentTimeMillis();
                        reconnectAttempts = 0;
                        FeedListener l = listener;
                        if (l != null) {
                            mainHandler.post(l::onFeedConnected);
                        }
                    }

                    @Override
                    public void onEvent(EventSource source, String id, String type, String data) {
                        lastEventAtMs = System.currentTimeMillis();
                        handleEvent(type, data);
                    }

                    @Override
                    public void onFailure(EventSource source, Throwable t, Response response) {
                        if (!running) {
                            return;
                        }
                        int code = response == null ? -1 : response.code();
                        Log.w(TAG, "SSE 断开: code=" + code, t);
                        if (code == 401) {
                            // token 失效：不自动重连，交给 UI 刷新后重新 start
                            running = false;
                            FeedListener l = listener;
                            if (l != null) {
                                mainHandler.post(l::onAuthError);
                            }
                            return;
                        }
                        notifyDisconnected("code=" + code
                                + (t == null ? "" : ", " + t.getMessage()));
                        scheduleReconnect();
                    }
                });
    }

    private void handleEvent(String type, String data) {
        if (type == null) {
            return;
        }
        try {
            switch (type) {
                case "snapshot": {
                    JsonObject obj = JsonParser.parseString(data).getAsJsonObject();
                    List<HudCard> fresh = new ArrayList<>();
                    long now = System.currentTimeMillis();
                    obj.getAsJsonArray("cards").forEach(el -> {
                        HudCard card = gson.fromJson(el, HudCard.class);
                        card.receivedAtMs = now;
                        fresh.add(card);
                    });
                    cards.clear();
                    for (HudCard card : fresh) {
                        cards.put(card.id, card);
                    }
                    tickerIndex = 0;
                    Log.i(TAG, "snapshot: " + fresh.size() + " 张卡");
                    // snapshot 后立即上屏最高优先级一张，不等轮播 tick
                    mainHandler.post(this::renderNext);
                    break;
                }
                case "card": {
                    HudCard card = gson.fromJson(data, HudCard.class);
                    card.receivedAtMs = System.currentTimeMillis();
                    cards.put(card.id, card);
                    // urgent/high 即时弹现并冻结滚动字幕 5s（分区卡走自己的区域）
                    if (card.priorityRank() <= 1 && !isZoneCard(card)) {
                        urgentHoldUntilMs = System.currentTimeMillis() + URGENT_HOLD_MS;
                        mainHandler.post(() -> render(card));
                    }
                    break;
                }
                case "heartbeat":
                    // lastEventAtMs 已在 onEvent 统一刷新
                    break;
                case "error":
                    Log.w(TAG, "服务端 error 事件: " + data);
                    break;
                default:
                    break;
            }
        } catch (RuntimeException e) {
            // 单条脏数据只丢弃，不断流
            Log.w(TAG, "事件解析失败(" + type + "): " + e.getMessage());
        }
    }

    // ===== 轮播 & 渲染 =====

    private final Runnable rotateRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) {
                return;
            }
            renderNext();
            mainHandler.postDelayed(this, ROTATE_INTERVAL_MS);
        }
    };

    /** 分区卡：风险→右上角、预测→底部，不进中央轮播 */
    private static boolean isZoneCard(HudCard card) {
        return card.id != null
                && (card.id.startsWith("world:risk:") || card.id.startsWith("world:sig:"));
    }

    /**
     * 右上角风险区紧凑文本：paddingLeft 硬推后剩余行宽只有 ~150dp，
     * 卡片原文“评分 64/100 · 中高”会折行成参差多行；
     * 压缩成两行短文本（去前缀、去空格）保证不折。
     */
    private static String compactRiskText(HudCard card) {
        String title = card.title == null ? "" : card.title;
        String body = card.body == null ? "" : card.body;
        body = body.replace("评分 ", "")
                .replace(" · ", "·")
                .replace(" ↑", "↑")
                .replace(" ↓", "↓");
        return body.isEmpty() ? title : title + "\n" + body;
    }

    /** 一拍分区渲染：右上角风险 + 底部预测轮播 + 中央其余卡轮播 */
    private void renderNext() {
        if (renderPaused) {
            return;
        }
        DisplayCapabilityManager display = DisplayCapabilityManager.getInstance();
        if (!display.isSceneOpened()) {
            return;
        }
        long now = System.currentTimeMillis();
        // TTL 清扫
        cards.values().removeIf(card -> card.isExpired(now));
        List<HudCard> risks = new ArrayList<>();
        List<HudCard> preds = new ArrayList<>();
        List<HudCard> center = new ArrayList<>();
        for (HudCard card : cards.values()) {
            if (card.id != null && card.id.startsWith("world:risk:")) {
                risks.add(card);
            } else if (card.id != null && card.id.startsWith("world:sig:")) {
                preds.add(card);
            } else {
                center.add(card);
            }
        }
        // 右上角：优先全球风险卡，否则取第一张；变化才重推
        risks.sort(Comparator.comparing(card -> card.id));
        HudCard riskCard = null;
        for (HudCard card : risks) {
            if (card.id.contains("global")) {
                riskCard = card;
                break;
            }
        }
        if (riskCard == null && !risks.isEmpty()) {
            riskCard = risks.get(0);
        }
        String riskText = riskCard == null ? " " : compactRiskText(riskCard);
        if (!riskText.equals(lastRiskText)) {
            display.updateRiskText(riskText, null);
            lastRiskText = riskText;
        }
        // 底部：预测卡独立轮播
        String predText = " ";
        if (!preds.isEmpty()) {
            preds.sort(Comparator.comparing(card -> card.id));
            predIndex = predIndex % preds.size();
            predText = preds.get(predIndex).toHudText();
            predIndex++;
        }
        if (!predText.equals(lastPredText)) {
            display.updatePredText(predText, null);
            lastPredText = predText;
        }
        // 中央：重建滚动字幕行列表（滚动本身由 tickerRunnable 驱动）
        rebuildTickerLines(center);
    }

    /** 把中央卡片内容切成定宽短行，供滚动字幕窗口使用 */
    private void rebuildTickerLines(List<HudCard> center) {
        center.sort(Comparator.comparingInt(HudCard::priorityRank)
                .thenComparing(card -> card.id));
        List<String> lines = new ArrayList<>();
        for (HudCard card : center) {
            addChunks(lines, "▸ " + (card.title == null ? "" : card.title));
            addChunks(lines, card.body);
            lines.add("\u00A0");   // 卡间空行（NBSP，固件不认空串）
        }
        if (!lines.equals(tickerLines)) {
            tickerLines.clear();
            tickerLines.addAll(lines);
            if (tickerIndex >= tickerLines.size()) {
                tickerIndex = 0;
            }
        }
    }

    private static void addChunks(List<String> lines, String text) {
        if (text == null || text.isEmpty()) {
            return;
        }
        for (int i = 0; i < text.length(); i += TICKER_LINE_CHARS) {
            lines.add(text.substring(i, Math.min(text.length(), i + TICKER_LINE_CHARS)));
        }
    }

    /** 中央滚动字幕：3 行窗口每拍上移一行，循环滚动 */
    private final Runnable tickerRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) {
                return;
            }
            mainHandler.postDelayed(this, TICKER_INTERVAL_MS);
            if (renderPaused || System.currentTimeMillis() < urgentHoldUntilMs) {
                return;
            }
            DisplayCapabilityManager display = DisplayCapabilityManager.getInstance();
            if (!display.isSceneOpened() || tickerLines.isEmpty()) {
                return;
            }
            String window;
            if (tickerLines.size() <= TICKER_WINDOW) {
                window = String.join("\n", tickerLines);
            } else {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < TICKER_WINDOW; i++) {
                    if (i > 0) {
                        sb.append('\n');
                    }
                    sb.append(tickerLines.get((tickerIndex + i) % tickerLines.size()));
                }
                tickerIndex = (tickerIndex + 1) % tickerLines.size();
                window = sb.toString();
            }
            if (!window.equals(lastCenterText)) {
                lastCenterText = window;
                display.updateText(window, null);
            }
        }
    };

    private void render(HudCard card) {
        if (renderPaused) {
            // 占屏演示中：卡片只留队列不上屏
            return;
        }
        DisplayCapabilityManager display = DisplayCapabilityManager.getInstance();
        if (!display.isSceneOpened()) {
            // 场景未开：只保留在队列里，等 openTextView 之后的轮播 tick
            return;
        }
        display.updateText(card.toHudText(),
                new BaseCapabilityManager.CapabilityCallback<Void>() {
                    @Override
                    public void onResult(Void result) {
                        FeedListener l = listener;
                        if (l != null) {
                            l.onCardShown(card);
                        }
                    }

                    @Override
                    public void onError(int errorCode, String message) {
                        Log.w(TAG, "HUD 上屏失败: code=" + errorCode + ", " + message);
                    }
                });
    }

    // ===== 保活 & 重连 =====

    private final Runnable livenessRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) {
                return;
            }
            long silent = System.currentTimeMillis() - lastEventAtMs;
            if (lastEventAtMs > 0 && silent > LIVENESS_TIMEOUT_MS) {
                Log.w(TAG, "heartbeat 静默 " + silent + "ms，强制重连");
                if (eventSource != null) {
                    eventSource.cancel();
                    eventSource = null;
                }
                notifyDisconnected("heartbeat timeout");
                scheduleReconnect();
                return;
            }
            mainHandler.postDelayed(this, LIVENESS_CHECK_MS);
        }
    };

    private final Runnable reconnectRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) {
                return;
            }
            Log.i(TAG, "重连中（第 " + reconnectAttempts + " 次）...");
            connect();
            mainHandler.postDelayed(livenessRunnable, LIVENESS_CHECK_MS);
        }
    };

    private void scheduleReconnect() {
        if (!running) {
            return;
        }
        long delay = Math.min(RECONNECT_MAX_MS,
                RECONNECT_BASE_MS << Math.min(reconnectAttempts, 5));
        reconnectAttempts++;
        mainHandler.removeCallbacks(livenessRunnable);
        mainHandler.removeCallbacks(reconnectRunnable);
        mainHandler.postDelayed(reconnectRunnable, delay);
        Log.i(TAG, delay + "ms 后重连");
    }

    private void notifyDisconnected(String reason) {
        FeedListener l = listener;
        if (l != null) {
            mainHandler.post(() -> l.onFeedDisconnected(reason));
        }
    }
}
