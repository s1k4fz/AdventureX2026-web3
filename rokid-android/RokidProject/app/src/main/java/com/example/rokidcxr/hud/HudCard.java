package com.example.rokidcxr.hud;

import com.google.gson.annotations.SerializedName;

/**
 * 一张 HUD 短文本卡片（后端契约见 backend/HUD.md 与 backend/schemas/hud.py）。
 *
 * 服务端已保证 title ≤24 字符、body ≤60 字符（按眼镜端 16sp 单色文本视图截断），
 * 手机端不再二次截断。`id` 是去重键：收到同 id 的 card 事件按原地覆盖处理。
 */
public final class HudCard {

    @SerializedName("id")
    public String id;

    /** world_signal | watch_due | agent_progress | policy_status */
    @SerializedName("kind")
    public String kind;

    /** urgent | high | normal | low */
    @SerializedName("priority")
    public String priority;

    @SerializedName("title")
    public String title;

    @SerializedName("body")
    public String body;

    @SerializedName("ts")
    public String ts;

    /** 收到后经过该秒数未被更新 → 客户端消隐 */
    @SerializedName("ttlSeconds")
    public int ttlSeconds = 300;

    @SerializedName("ref")
    public Ref ref;

    /** 本地接收时刻（毫秒），用于 TTL 消隐判断；不参与 JSON 序列化 */
    public transient long receivedAtMs;

    public static final class Ref {
        @SerializedName("type")
        public String type;

        @SerializedName("id")
        public String id;
    }

    /** 优先级序：urgent(0) > high(1) > normal(2) > low(3)，未知按最低 */
    public int priorityRank() {
        if (priority == null) {
            return 9;
        }
        switch (priority) {
            case "urgent":
                return 0;
            case "high":
                return 1;
            case "normal":
                return 2;
            case "low":
                return 3;
            default:
                return 9;
        }
    }

    public boolean isExpired(long nowMs) {
        return nowMs - receivedAtMs > ttlSeconds * 1000L;
    }

    /** HUD 单文本节点的最终显示串：title 换行 body（body 为空时只有 title） */
    public String toHudText() {
        if (body == null || body.isEmpty()) {
            return title == null ? "" : title;
        }
        return title + "\n" + body;
    }
}
