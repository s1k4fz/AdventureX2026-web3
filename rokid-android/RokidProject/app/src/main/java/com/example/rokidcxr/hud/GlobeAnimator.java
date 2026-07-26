package com.example.rokidcxr.hud;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.example.rokidcxr.sdk.capability.BaseCapabilityManager;
import com.example.rokidcxr.sdk.capability.DisplayCapabilityManager;
import com.example.rokidcxr.sdk.capability.StatusCapabilityManager;

/**
 * 左下角小地球自转 ASCII 动画（HUD 常驻装饰件）。
 *
 * 原理：把粗粒度等距圆柱（equirectangular）世界地图投影到正交球面，
 * 逐帧偏移经度模拟自转；预生成全部帧后 Handler 定时刷新视图树里的
 * 独立 globeView 节点（9sp 等宽，建树时已固定），与卡片文本互不干扰，
 * 卡片轮播照常进行。
 *
 * 带宽考量：12×24 小帧 ~0.5KB JSON，280ms/帧远低于 CXR 链路能力。
 */
public final class GlobeAnimator {

    private static final String TAG = "GlobeAnimator";

    private static final int FRAMES = 36;
    private static final int ROWS = 12;
    private static final int COLS = 24;
    private static final long FRAME_INTERVAL_MS = 280L;
    private static final char LAND = '█';
    private static final char SEA = '·';
    /** 圆外填充：不换行空格（NBSP）—— 普通行尾空格会被 TextView 测量剔除，
     * 导致节点宽度逐帧抖动，同行的右上角风险区会跟着左右跳 */
    private static final char VOID = '\u00A0';

    /**
     * 粗粒度世界地图（'#'=陆地）：行=纬度 90N→90S 每行 10°，列=经度 180W→180E。
     * 分辨率够球面采样即可，不追求岸线精确。
     */
    private static final String[] WORLD_MAP = {
            "                                                                        ",
            "        ## ## ###         ####                  ################        ",
            "    ################      ####      #### ##############################",
            "   ##################            ##  ##################################",
            "    #################             ##################################   ",
            "      ##############              ########################  ##  ##     ",
            "        #########                #############################         ",
            "          #####                 ###############  ####  ## ###          ",
            "                 #######         ############      ##  ## # ##         ",
            "                ##########        ##########       # ### ## #          ",
            "                 #########        ########             ########        ",
            "                  ########         ######             #########        ",
            "                  #######           ####               ######          ",
            "                  #####                                     ##         ",
            "                  ###                                                   ",
            "                                                                        ",
            "           ##########      #################   ##############          ",
            "      ##############################################################    ",
    };

    private static volatile GlobeAnimator sInstance;

    public static GlobeAnimator getInstance() {
        if (sInstance == null) {
            synchronized (GlobeAnimator.class) {
                if (sInstance == null) {
                    sInstance = new GlobeAnimator();
                }
            }
        }
        return sInstance;
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String[] frames;
    private int frameIndex = 0;
    private volatile boolean running = false;

    private GlobeAnimator() {
    }

    public boolean isRunning() {
        return running;
    }

    public void start() {
        if (running) {
            return;
        }
        if (frames == null) {
            frames = generateFrames();
        }
        running = true;
        frameIndex = 0;
        mainHandler.post(tick);
        // 启动状态监听（蓝牙+电池）
        StatusCapabilityManager.getInstance().start();
        Log.i(TAG, "左下角地球动画开始（" + FRAMES + " 帧 / " + FRAME_INTERVAL_MS + "ms）");
    }
    
    public void stop() {
        if (!running) {
            return;
        }
        running = false;
        mainHandler.removeCallbacks(tick);
        // 单空格即视觉隐藏（空串固件不认），卡片文本不受影响
        DisplayCapabilityManager.getInstance().updateGlobeText(" ", null);
        // 停止状态监听
        StatusCapabilityManager.getInstance().stop();
        Log.i(TAG, "地球动画停止");
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!running) {
                return;
            }
            String frame = frames[frameIndex];
            frameIndex = (frameIndex + 1) % frames.length;
            DisplayCapabilityManager.getInstance().updateGlobeText(frame,
                    new BaseCapabilityManager.CapabilityCallback<Void>() {
                        @Override
                        public void onResult(Void result) {
                        }

                        @Override
                        public void onError(int errorCode, String message) {
                            Log.w(TAG, "帧发送失败: code=" + errorCode + ", " + message);
                        }
                    });
            mainHandler.postDelayed(this, FRAME_INTERVAL_MS);
        }
    };

    /**
     * 正交投影球面采样：屏幕圆内每个字符格 → 球面经纬度 → 查地图定陆海。
     * ROWS=12 行 × COLS=24 列，等宽字体下字符格高宽比 ≈2:1，恰好呈圆形。
     */
    private String[] generateFrames() {
        int mapH = WORLD_MAP.length;
        int mapW = 0;
        for (String row : WORLD_MAP) {
            mapW = Math.max(mapW, row.length());
        }
        String[] out = new String[FRAMES];
        for (int f = 0; f < FRAMES; f++) {
            double lonOffset = 2 * Math.PI * f / FRAMES;
            StringBuilder sb = new StringBuilder((ROWS + 1) * (COLS + 1));
            for (int r = 0; r < ROWS; r++) {
                double y = 2.0 * r / (ROWS - 1) - 1.0;
                for (int c = 0; c < COLS; c++) {
                    double x = 2.0 * c / (COLS - 1) - 1.0;
                    double d2 = x * x + y * y;
                    if (d2 > 1.0) {
                        sb.append(VOID);
                        continue;
                    }
                    double z = Math.sqrt(1.0 - d2);
                    double lat = Math.asin(y);                 // -π/2=北极 … π/2=南极
                    double lon = Math.atan2(x, z) + lonOffset; // 可见半球 ±π/2 + 自转偏移
                    int v = (int) ((lat / Math.PI + 0.5) * mapH);
                    if (v < 0) {
                        v = 0;
                    } else if (v >= mapH) {
                        v = mapH - 1;
                    }
                    double frac = (lon + Math.PI) / (2 * Math.PI);
                    frac -= Math.floor(frac);
                    int u = (int) (frac * mapW);
                    String rowStr = WORLD_MAP[v];
                    char m = u < rowStr.length() ? rowStr.charAt(u) : ' ';
                    sb.append(m == '#' ? LAND : SEA);
                }
                if (r < ROWS - 1) {
                    sb.append('\n');
                }
            }
            out[f] = sb.toString();
        }
        return out;
    }
}
