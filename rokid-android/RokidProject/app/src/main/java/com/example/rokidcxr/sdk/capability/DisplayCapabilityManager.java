package com.example.rokidcxr.sdk.capability;

import android.util.Log;

import com.example.rokidcxr.sdk.CxrSdkManager;
import com.rokid.cxr.link.CXRLink;
import com.rokid.cxr.link.callbacks.ICustomViewCbk;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 显示能力 Manager（单例）：基于 CUSTOMVIEW 会话向眼镜推送自定义视图。
 *
 * 官方 API（client-l:1.0.3）：
 *   setCXRCustomViewCbk(ICustomViewCbk) / customViewSetIcons(json) / customViewOpen(json)
 *   / customViewUpdate(jsonArray) / customViewClose() / customViewIsOpen()
 *
 * 调用顺序约束：
 * 1. 链路双条件就绪后才能 customViewSetIcons / customViewOpen
 * 2. 收到 onCustomViewOpened 后（场景构建完成）才能使用音频/拍照子能力
 * 3. 增量刷新用 customViewUpdate（action=update, 按 props.id 定位）
 * 4. 眼镜显示偏绿色单色风格，勿假设全彩还原
 */
public final class DisplayCapabilityManager extends BaseCapabilityManager {

    private static final String TAG = "DisplayCapability";

    /** 默认文本节点 id，用于 updateText 增量刷新 */
    private static final String TEXT_NODE_ID = "textView";

    /** 左上角小地球节点 id：与卡片文本独立，动画刷它不干扰卡片 */
    private static final String GLOBE_NODE_ID = "globeView";

    /** 右上角全球风险区节点 id */
    private static final String RISK_NODE_ID = "riskView";

    /** 蓝牙和电池状态区节点 id（风险区左边） */
    private static final String STATUS_NODE_ID = "statusView";

    /** 时间日期显示区节点 id（状态和风险之间） */
    private static final String TIME_NODE_ID = "timeView";

    /** 底部预测市场区节点 id */
    private static final String PRED_NODE_ID = "predView";

    // ===== HUD 对齐参数（根据真机佩戴反馈迭代，改这里即可）=====
    /** 校准线粗细：对齐已完成，边框下岗。0dp=隐藏；需要重新校准时改回 2dp */
    private static final String FRAME_STROKE = "0dp";
    /** 框体整体下移量：可视区偏下，顶部留空把绿框压下去 */
    private static final String FRAME_OFFSET_TOP = "80dp";

    /** 风险区右推量：固件不实现任何水平对齐属性，只能用 paddingLeft 物理硬推。
     * 实测校准：300dp 时一字一行 → 可视区内容宽度≈310dp；
     * 最长行“64/100·中高”≈12sp×~100dp → 推量 190dp 留足一行宽度。
     * 不够靠右加大；再折行就减小 */
    private static final String RISK_PUSH_LEFT = "190dp";

    /** 场景（CustomView）状态监听 */
    public interface SceneListener {
        void onSceneOpened();

        void onSceneClosed();

        void onSceneError(int code, String message);
    }

    private static volatile DisplayCapabilityManager sInstance;

    public static DisplayCapabilityManager getInstance() {
        if (sInstance == null) {
            synchronized (DisplayCapabilityManager.class) {
                if (sInstance == null) {
                    sInstance = new DisplayCapabilityManager();
                }
            }
        }
        return sInstance;
    }

    /** 场景构建是否完成（onCustomViewOpened 后为 true）——音频/拍照的前置条件 */
    private volatile boolean sceneOpened = false;
    private SceneListener sceneListener;

    private DisplayCapabilityManager() {
    }

    public boolean isSceneOpened() {
        return sceneOpened;
    }

    public void setSceneListener(SceneListener listener) {
        this.sceneListener = listener;
    }

    /**
     * 注册 CustomView 回调（connect 发起后调用一次）。
     */
    public void registerCallback() {
        CXRLink link = CxrSdkManager.getInstance().getLink();
        if (link == null) {
            Log.w(TAG, "registerCallback: link 为空");
            return;
        }
        link.setCXRCustomViewCbk(new ICustomViewCbk() {
            @Override
            public void onCustomViewOpened() {
                Log.i(TAG, "onCustomViewOpened（场景构建完成）");
                sceneOpened = true;
                SceneListener l = sceneListener;
                if (l != null) {
                    mainHandler.post(l::onSceneOpened);
                }
            }

            @Override
            public void onCustomViewUpdated() {
                Log.i(TAG, "onCustomViewUpdated");
            }

            @Override
            public void onCustomViewClosed() {
                Log.i(TAG, "onCustomViewClosed");
                sceneOpened = false;
                SceneListener l = sceneListener;
                if (l != null) {
                    mainHandler.post(l::onSceneClosed);
                }
            }

            @Override
            public void onCustomViewIconsSent() {
                Log.i(TAG, "onCustomViewIconsSent");
            }

            @Override
            public void onCustomViewError(int code, String msg) {
                Log.e(TAG, "onCustomViewError: code=" + code + ", " + msg);
                sceneOpened = false;
                SceneListener l = sceneListener;
                if (l != null) {
                    mainHandler.post(() -> l.onSceneError(code, msg));
                }
            }
        });
        Log.i(TAG, "registerCallback 完成");
    }

    /**
     * 打开一个居中显示单行文本的 CustomView（最常用场景：提词/翻译/通知）。
     * 前置：链路双条件就绪。若视图已打开则自动降级为增量更新（幂等）。
     */
    public void openTextView(String text, CapabilityCallback<Void> callback) {
        String err = preCheck();
        if (err != null) {
            postError(callback, preCheckErrorCode(), err);
            return;
        }
        if (sceneOpened) {
            // 视图已打开：重复 open 会被 SDK 拒绝，自动转为增量更新
            Log.i(TAG, "openTextView: 视图已打开，自动转为 updateText");
            updateText(text, callback);
            return;
        }
        CXRLink link = CxrSdkManager.getInstance().getLink();
        String viewJson;
        try {
            viewJson = buildTextViewTree(text).toString();
        } catch (JSONException e) {
            postError(callback, ERR_UNSUPPORTED, "视图 JSON 构造失败: " + e.getMessage());
            return;
        }
        // 状态自愈：进程重启后眼镜端旧视图可能仍开着。旧视图的版式是旧代码生成的，
        // 直接 updateText 不会应用新版式（校准框/居中）：先关闭再延迟重建。
        if (link.customViewIsOpen()) {
            Log.i(TAG, "openTextView: 眼镜端旧视图仍在，先关闭再重建（应用新版式）");
            link.customViewClose();
            sceneOpened = false;
            mainHandler.postDelayed(() -> {
                boolean ok = link.customViewOpen(viewJson);
                Log.i(TAG, "openTextView(rebuild): " + ok + " json=" + viewJson);
                if (!ok) {
                    postError(callback, ERR_UNSUPPORTED, "customViewOpen 发送失败");
                }
            }, 600);
            postResult(callback, null);
            return;
        }
        Log.i(TAG, "openTextView: " + viewJson);
        boolean sent = link.customViewOpen(viewJson);
        if (sent) {
            // 打开结果经 onCustomViewOpened / onCustomViewError 回调，此处仅表示指令已发出
            postResult(callback, null);
        } else {
            postError(callback, ERR_UNSUPPORTED, "customViewOpen 发送失败");
        }
    }

    /**
     * 增量更新文本内容（场景已打开时使用，避免整屏重建）。
     * 前置：onCustomViewOpened 已收到。
     */
    public void updateText(String text, CapabilityCallback<Void> callback) {
        updateNode(TEXT_NODE_ID, text, null, callback);
    }

    /** 刷新左上角小地球字符画（传单空格即隐藏） */
    public void updateGlobeText(String text, CapabilityCallback<Void> callback) {
        updateNode(GLOBE_NODE_ID, text, null, callback);
    }

    /** 刷新右上角全球风险区（传单空格即隐藏） */
    public void updateRiskText(String text, CapabilityCallback<Void> callback) {
        updateNode(RISK_NODE_ID, text, null, callback);
    }

    /** 刷新蓝牙和电池状态区（传单空格即隐藏） */
    public void updateStatusText(String text, CapabilityCallback<Void> callback) {
        updateNode(STATUS_NODE_ID, text, null, callback);
    }

    /** 刷新时间日期区（传单空格即隐藏） */
    public void updateTimeText(String text, CapabilityCallback<Void> callback) {
        updateNode(TIME_NODE_ID, text, null, callback);
    }

    /** 刷新底部预测市场区（传单空格即隐藏） */
    public void updatePredText(String text, CapabilityCallback<Void> callback) {
        updateNode(PRED_NODE_ID, text, null, callback);
    }

    /**
     * 增量更新文本 + 可选字号（历史兼容；字号动态修改部分固件不支持，
     * 新代码优先用建树时固定字号的独立节点）。
     */
    public void updateStyledText(String text, String textSizeSp, CapabilityCallback<Void> callback) {
        updateNode(TEXT_NODE_ID, text, textSizeSp, callback);
    }

    private void updateNode(String nodeId, String text, String textSizeSp,
                            CapabilityCallback<Void> callback) {
        String err = preCheck();
        if (err != null) {
            postError(callback, preCheckErrorCode(), err);
            return;
        }
        if (!sceneOpened) {
            postError(callback, ERR_SCENE_NOT_READY, "CustomView 未打开，请先 openTextView");
            return;
        }
        CXRLink link = CxrSdkManager.getInstance().getLink();
        String updateJson;
        try {
            JSONObject props = new JSONObject().put("text", text);
            if (textSizeSp != null) {
                props.put("textSize", textSizeSp);
            }
            JSONObject update = new JSONObject();
            update.put("action", "update");
            update.put("id", nodeId);
            update.put("props", props);
            updateJson = new JSONArray().put(update).toString();
        } catch (JSONException e) {
            postError(callback, ERR_UNSUPPORTED, "更新 JSON 构造失败: " + e.getMessage());
            return;
        }
        boolean sent = link.customViewUpdate(updateJson);
        if (sent) {
            postResult(callback, null);
        } else {
            postError(callback, ERR_UNSUPPORTED, "customViewUpdate 发送失败");
        }
    }

    /** 关闭 CustomView（会话真正结束时调用，如 Activity.isFinishing） */
    public void closeView() {
        CXRLink link = CxrSdkManager.getInstance().getLink();
        if (link == null) {
            return;
        }
        Log.i(TAG, "closeView()");
        link.customViewClose();
        sceneOpened = false;
    }

    /**
     * 构造官方协议的视图树：三分区仪表盘。
     *
     * 结构：
     *   root（黑底全幅）
     *     └ frame（绿底，marginTop=FRAME_OFFSET_TOP 整体下移）
     *         └ content（黑底，四边各留 FRAME_STROKE 露出绿线，纵向叠放）
     *             ├ riskView（独立整行右对齐，贴右侧绿线；不与地球同行，
     *             │  彻底隔离地球逐帧宽度抖动的影响）
     *             ├ globeView（小地球贴左，自成一行）
     *             ├ textView（卡片文字 16sp，居中）
     *             └ bottomWrap（占满剩余高度，gravity=bottom）
     *                 └ predView（预测市场 12sp，紧贴底部绿线）
     * 注意：不用 layout_weight（固件解析器不支持，会卡死不回
     * onCustomViewOpened）；所有初始文本用单空格而非空串。
     * 协议要点：显式 dp/sp 单位；props.id 全局唯一以支持增量更新。
     */
    private JSONObject buildTextViewTree(String text) throws JSONException {
        // 小地球：居中展示（容器 gravity=center 已验证可用）；宽度抖动不影响其他节点
        JSONObject globeNode = new JSONObject()
                .put("type", "TextView")
                .put("props", new JSONObject()
                        .put("id", GLOBE_NODE_ID)
                        .put("layout_width", "wrap_content")
                        .put("layout_height", "wrap_content")
                        .put("text", " ")
                        .put("textColor", "#00FF00")
                        .put("textSize", "9sp")
                        .put("fontFamily", "monospace")
                        .put("typeface", "monospace")
                        .put("marginTop", "0dp"));
        JSONObject globeRow = new JSONObject()
                .put("type", "LinearLayout")
                .put("props", new JSONObject()
                        .put("id", "globeRow")
                        .put("layout_width", "match_parent")
                        .put("layout_height", "wrap_content")
                        .put("orientation", "vertical")
                        .put("gravity", "center"))
                .put("children", new JSONArray().put(globeNode));
        // 蓝牙和电池状态区 + 风险区：放同一行，status 在左，risk 在右
        // 风险区不使用 match_parent，而是 wrap_content + layout_gravity=right
        JSONObject statusNode = new JSONObject()
                .put("type", "TextView")
                .put("props", new JSONObject()
                        .put("id", STATUS_NODE_ID)
                        .put("layout_width", "wrap_content")
                        .put("layout_height", "wrap_content")
                        .put("text", " ")
                        .put("textColor", "#00FF00")
                        .put("textSize", "12sp")
                        .put("fontFamily", "monospace")
                        .put("typeface", "monospace")
                        .put("marginTop", "2dp")
                        .put("gravity", "center_vertical")
                        .put("paddingStart", "8dp")
                        .put("paddingEnd", "8dp"));
        JSONObject riskNode = new JSONObject()
                .put("type", "TextView")
                .put("props", new JSONObject()
                        .put("id", RISK_NODE_ID)
                        .put("layout_width", "wrap_content")
                        .put("layout_height", "wrap_content")
                        .put("text", " ")
                        .put("textColor", "#00FF00")
                        .put("textSize", "12sp")
                        .put("fontFamily", "monospace")
                        .put("typeface", "monospace")
                        .put("marginTop", "4dp")
                        .put("marginBottom", "2dp")
                        .put("layout_gravity", "right|center_vertical")
                        .put("gravity", "right|center_vertical")
                        .put("paddingStart", "8dp")
                        .put("paddingEnd", "8dp"));
        // 时间日期区（状态和风险之间）：宽度自适应，两行（时间在上，日期在下）
        JSONObject timeNode = new JSONObject()
                .put("type", "TextView")
                .put("props", new JSONObject()
                        .put("id", TIME_NODE_ID)
                        .put("layout_width", "wrap_content")
                        .put("layout_height", "wrap_content")
                        .put("text", " ")
                        .put("textColor", "#00FF00")
                        .put("textSize", "12sp")
                        .put("fontFamily", "monospace")
                        .put("typeface", "monospace")
                        .put("marginTop", "2dp")
                        .put("gravity", "center_vertical|center")
                        .put("paddingStart", "8dp")
                        .put("paddingEnd", "8dp"));
        // 中央卡片文字
        JSONObject textNode = new JSONObject()
                .put("type", "TextView")
                .put("props", new JSONObject()
                        .put("id", TEXT_NODE_ID)
                        .put("layout_width", "match_parent")
                        .put("layout_height", "wrap_content")
                        .put("marginTop", "6dp")
                        .put("text", text)
                        .put("textColor", "#00FF00")
                        .put("textSize", "16sp")
                        .put("fontFamily", "monospace")
                        .put("typeface", "monospace")
                        .put("gravity", "center")
                        .put("paddingStart", "8dp")
                        .put("paddingEnd", "8dp"));
        // 底部预测市场区：外层 bottomWrap 吃掉剩余高度（纵向 LL 里 match_parent
        // 高度的后置子节点取剩余空间，同 riskView 吃余宽的已验证机制），
        // gravity=bottom 把预测文本压到底部绿线上
        JSONObject predNode = new JSONObject()
                .put("type", "TextView")
                .put("props", new JSONObject()
                        .put("id", PRED_NODE_ID)
                        .put("layout_width", "match_parent")
                        .put("layout_height", "wrap_content")
                        .put("text", " ")
                        .put("textColor", "#00FF00")
                        .put("textSize", "12sp")
                        .put("fontFamily", "monospace")
                        .put("typeface", "monospace")
                        .put("gravity", "center")
                        .put("marginBottom", "2dp")
                        .put("paddingStart", "8dp")
                        .put("paddingEnd", "8dp"));
        JSONObject bottomWrap = new JSONObject()
                .put("type", "LinearLayout")
                .put("props", new JSONObject()
                        .put("id", "bottomWrap")
                        .put("layout_width", "match_parent")
                        .put("layout_height", "match_parent")
                        .put("orientation", "vertical")
                        .put("gravity", "bottom"))
                .put("children", new JSONArray().put(predNode));
        // 内层黑底内容区：四边各留 FRAME_STROKE 露出绿线；纵向叠放，不设整体
        // gravity（卡片靠 weight 居中，地球默认贴左）。
        // 左右边距同时下发 Left/Right 与 Start/End 两套属性：Rokid 解析器只认老式
        // marginLeft/Right 时 Start/End 会被静默忽略，导致左右两条线画不出来。
        // 状态区+风险区：同一行，使用 LinearLayout 包裹
        JSONObject statusRiskRow = new JSONObject()
                .put("type", "LinearLayout")
                .put("props", new JSONObject()
                        .put("id", "statusRiskRow")
                        .put("layout_width", "match_parent")
                        .put("layout_height", "wrap_content")
                        .put("orientation", "horizontal")
                        .put("gravity", "center_vertical"))
                .put("children", new JSONArray().put(statusNode).put(timeNode).put(riskNode));
        JSONObject content = new JSONObject()
                .put("type", "LinearLayout")
                .put("props", new JSONObject()
                        .put("id", "content")
                        .put("layout_width", "match_parent")
                        .put("layout_height", "match_parent")
                        .put("marginTop", FRAME_STROKE)
                        .put("marginBottom", FRAME_STROKE)
                        .put("marginLeft", FRAME_STROKE)
                        .put("marginRight", FRAME_STROKE)
                        .put("marginStart", FRAME_STROKE)
                        .put("marginEnd", FRAME_STROKE)
                        .put("backgroundColor", "#FF000000")
                        .put("orientation", "vertical"))
                .put("children", new JSONArray()
                        .put(statusRiskRow).put(globeRow).put(textNode).put(bottomWrap));
        // 绿底框层：整体下移，左右 0 边距顶满可视区
        JSONObject frame = new JSONObject()
                .put("type", "LinearLayout")
                .put("props", new JSONObject()
                        .put("id", "frame")
                        .put("layout_width", "match_parent")
                        .put("layout_height", "match_parent")
                        .put("marginTop", FRAME_OFFSET_TOP)
                        .put("backgroundColor", "#FF00FF00")
                        .put("orientation", "vertical"))
                .put("children", new JSONArray().put(content));
        return new JSONObject()
                .put("type", "LinearLayout")
                .put("props", new JSONObject()
                        .put("id", "root")
                        .put("layout_width", "match_parent")
                        .put("layout_height", "match_parent")
                        .put("backgroundColor", "#FF000000")
                        .put("orientation", "vertical"))
                .put("children", new JSONArray().put(frame));
    }
}
