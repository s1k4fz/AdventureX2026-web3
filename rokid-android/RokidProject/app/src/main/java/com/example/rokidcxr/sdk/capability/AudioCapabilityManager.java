package com.example.rokidcxr.sdk.capability;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Log;

import com.example.rokidcxr.sdk.CxrSdkManager;
import com.rokid.cxr.link.CXRLink;
import com.rokid.cxr.link.callbacks.IAudioStreamCbk;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * 音频能力 Manager（单例）：眼镜端麦克风音频流采集。
 *
 * 官方 API（client-l:1.0.3）：
 *   setCXRAudioCbk(IAudioStreamCbk) / startAudioStream(codecType=1) / stopAudioStream()
 *   回调 onAudioReceived(data, offset, length) 返回 PCM 分片。
 *
 * PCM 参数（官方固定）：16000 Hz / 单声道 / 16 bit
 * 时长估算：pcmBytes / (16000 * 2) 秒
 *
 * 约束：
 * 1. 前置：链路双条件就绪 + 场景构建完成（onCustomViewOpened / appStart 成功）
 * 2. 建议已授予 GlassPermission.MICROPHONE（授权阶段申请）
 * 3. 音频帧回调保持 SDK 原始线程（不切主线程，降低延迟），监听器内严禁耗时操作
 * 4. 子页面 onDestroy 调 stopAudioStream()，不要 disconnect()
 */
public final class AudioCapabilityManager extends BaseCapabilityManager {

    private static final String TAG = "AudioCapability";

    /** 官方指定 codecType */
    public static final int CODEC_TYPE_DEFAULT = 1;

    public static final int SAMPLE_RATE = 16000;
    public static final int CHANNELS = 1;
    public static final int BIT_DEPTH = 16;

    /** 音频流监听（帧回调保持 SDK 原始线程，勿做耗时操作） */
    public interface AudioStreamListener {
        /**
         * PCM 分片。注意按 offset/length 边界读取，勿直接使用整个数组。
         */
        void onAudioFrame(byte[] data, int offset, int length);

        /** 流状态变化 */
        void onStreamStateChanged(boolean started);

        /** 采集错误（发生后应停止流并提示用户） */
        void onAudioError(int code, String message);
    }

    private static volatile AudioCapabilityManager sInstance;

    public static AudioCapabilityManager getInstance() {
        if (sInstance == null) {
            synchronized (AudioCapabilityManager.class) {
                if (sInstance == null) {
                    sInstance = new AudioCapabilityManager();
                }
            }
        }
        return sInstance;
    }

    private volatile boolean streaming = false;
    private volatile AudioStreamListener listener;

    /** 采集缓冲：原始 SDK 线程写入，回放线程读取，用锁保护 */
    private final Object captureLock = new Object();
    private ByteArrayOutputStream captureBuffer;

    /** 回放状态（AudioTrack 在独立线程） */
    private volatile boolean playing = false;
    private volatile AudioTrack audioTrack;

    /** 回放监听（主线程回调） */
    public interface PlaybackListener {
        void onPlaybackStart(int pcmBytes, int seconds);

        void onPlaybackFinish();

        void onPlaybackError(String message);
    }

    private AudioCapabilityManager() {
    }

    public boolean isStreaming() {
        return streaming;
    }

    public boolean isPlaying() {
        return playing;
    }

    /** 最近一次采集的 PCM 快照（可能为空） */
    public byte[] getCapturedPcm() {
        synchronized (captureLock) {
            return captureBuffer == null ? null : captureBuffer.toByteArray();
        }
    }

    public int getCapturedByteCount() {
        synchronized (captureLock) {
            return captureBuffer == null ? 0 : captureBuffer.size();
        }
    }

    /**
     * 注册音频回调（connect 发起后调用一次）。
     */
    public void registerCallback() {
        CXRLink link = CxrSdkManager.getInstance().getLink();
        if (link == null) {
            Log.w(TAG, "registerCallback: link 为空");
            return;
        }
        link.setCXRAudioCbk(new IAudioStreamCbk() {
            @Override
            public void onAudioReceived(byte[] data, int offset, int length) {
                // 累计到采集缓冲（用于事后回放/存 WAV）
                synchronized (captureLock) {
                    if (captureBuffer != null && length > 0) {
                        captureBuffer.write(data, offset, length);
                    }
                }
                AudioStreamListener l = listener;
                if (l != null) {
                    l.onAudioFrame(data, offset, length); // 保持原始线程
                }
            }

            @Override
            public void onAudioStreamStateChanged(boolean started) {
                Log.i(TAG, "onAudioStreamStateChanged: " + started);
                streaming = started;
                AudioStreamListener l = listener;
                if (l != null) {
                    mainHandler.post(() -> l.onStreamStateChanged(started));
                }
            }

            @Override
            public void onAudioError(int code, String info) {
                Log.e(TAG, "onAudioError: code=" + code + ", " + info);
                streaming = false;
                AudioStreamListener l = listener;
                if (l != null) {
                    mainHandler.post(() -> l.onAudioError(code, info));
                }
            }
        });
        Log.i(TAG, "registerCallback 完成");
    }

    /**
     * 开始眼镜端音频流采集。
     */
    public void startAudioStream(AudioStreamListener streamListener, CapabilityCallback<Void> callback) {
        String err = preCheck();
        if (err != null) {
            postError(callback, preCheckErrorCode(), err);
            return;
        }
        if (!DisplayCapabilityManager.getInstance().isSceneOpened()) {
            postError(callback, ERR_SCENE_NOT_READY, "场景未构建完成，禁止仅链路连通就开流");
            return;
        }
        if (streaming) {
            postError(callback, ERR_UNSUPPORTED, "音频流已开启，请勿重复调用");
            return;
        }
        this.listener = streamListener;
        // 重置采集缓冲，开始累积新一轮 PCM
        synchronized (captureLock) {
            captureBuffer = new ByteArrayOutputStream();
        }
        CXRLink link = CxrSdkManager.getInstance().getLink();
        Log.i(TAG, "startAudioStream(codecType=" + CODEC_TYPE_DEFAULT + ")");
        boolean sent = link.startAudioStream(CODEC_TYPE_DEFAULT);
        if (sent) {
            // 开启结果经 onAudioStreamStateChanged 回调
            postResult(callback, null);
        } else {
            this.listener = null;
            postError(callback, ERR_UNSUPPORTED, "startAudioStream 发送失败");
        }
    }

    /** 停止音频流采集（子页面 onDestroy 必须调用） */
    public void stopAudioStream() {
        CXRLink link = CxrSdkManager.getInstance().getLink();
        if (link == null || !streaming) {
            return;
        }
        Log.i(TAG, "stopAudioStream()");
        link.stopAudioStream();
        streaming = false;
        listener = null;
    }

    // ===== 回放 / 存档 =====

    /**
     * 回放最近一次采集的 PCM（AudioTrack，输出路由跟随系统：连了蓝牙耳机就走蓝牙）。
     * 在独立线程播放，回调走主线程。
     */
    public void playLastCapture(final PlaybackListener cb) {
        final byte[] pcm = getCapturedPcm();
        if (pcm == null || pcm.length == 0) {
            if (cb != null) mainHandler.post(() -> cb.onPlaybackError("无音频数据，请先采集"));
            return;
        }
        if (playing) {
            if (cb != null) mainHandler.post(() -> cb.onPlaybackError("正在回放中"));
            return;
        }
        playing = true;
        new Thread(() -> {
            AudioTrack track = null;
            try {
                int minBuf = AudioTrack.getMinBufferSize(SAMPLE_RATE,
                        AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                int bufSize = Math.max(minBuf, 8192);
                track = new AudioTrack.Builder()
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                                .build())
                        .setAudioFormat(new AudioFormat.Builder()
                                .setSampleRate(SAMPLE_RATE)
                                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                .build())
                        .setBufferSizeInBytes(bufSize)
                        .setTransferMode(AudioTrack.MODE_STREAM)
                        .build();
                audioTrack = track;
                final int seconds = pcm.length / (SAMPLE_RATE * 2);
                if (cb != null) mainHandler.post(() -> cb.onPlaybackStart(pcm.length, seconds));
                track.play();
                int written = 0;
                while (written < pcm.length && playing) {
                    int chunk = Math.min(4096, pcm.length - written);
                    int n = track.write(pcm, written, chunk);
                    if (n <= 0) break;
                    written += n;
                }
                // MODE_STREAM：stop() 会把已写入的尾部数据播完
                track.stop();
                if (cb != null) mainHandler.post(cb::onPlaybackFinish);
            } catch (Exception e) {
                Log.e(TAG, "playLastCapture 异常", e);
                if (cb != null) mainHandler.post(() -> cb.onPlaybackError(String.valueOf(e.getMessage())));
            } finally {
                playing = false;
                if (track != null) {
                    try {
                        track.release();
                    } catch (Exception ignore) {
                    }
                }
                audioTrack = null;
            }
        }, "cxr-audio-playback").start();
    }

    /** 中断回放 */
    public void stopPlayback() {
        playing = false;
    }

    /**
     * 将最近一次采集的 PCM 存为 WAV 文件（便于 adb pull 出来用播放器验证）。
     *
     * @return 生成的文件；无数据时返回 null
     */
    public File saveLastCaptureAsWav(File dir) throws IOException {
        byte[] pcm = getCapturedPcm();
        if (pcm == null || pcm.length == 0) {
            return null;
        }
        if (dir != null && !dir.exists()) {
            dir.mkdirs();
        }
        File out = new File(dir, "cxr_audio_" + System.currentTimeMillis() + ".wav");
        try (FileOutputStream fos = new FileOutputStream(out)) {
            writeWavHeader(fos, pcm.length, SAMPLE_RATE, CHANNELS, BIT_DEPTH);
            fos.write(pcm);
        }
        return out;
    }

    /** 写标准 44 字节 WAV 头（PCM） */
    private static void writeWavHeader(FileOutputStream fos, int pcmLen,
                                       int sampleRate, int channels, int bitDepth) throws IOException {
        int byteRate = sampleRate * channels * bitDepth / 8;
        int blockAlign = channels * bitDepth / 8;
        int totalLen = pcmLen + 36;
        byte[] h = new byte[44];
        // RIFF chunk
        h[0] = 'R'; h[1] = 'I'; h[2] = 'F'; h[3] = 'F';
        writeIntLE(h, 4, totalLen);
        h[8] = 'W'; h[9] = 'A'; h[10] = 'V'; h[11] = 'E';
        // fmt subchunk
        h[12] = 'f'; h[13] = 'm'; h[14] = 't'; h[15] = ' ';
        writeIntLE(h, 16, 16);            // subchunk1 size (PCM)
        writeShortLE(h, 20, (short) 1);   // audio format = PCM
        writeShortLE(h, 22, (short) channels);
        writeIntLE(h, 24, sampleRate);
        writeIntLE(h, 28, byteRate);
        writeShortLE(h, 32, (short) blockAlign);
        writeShortLE(h, 34, (short) bitDepth);
        // data subchunk
        h[36] = 'd'; h[37] = 'a'; h[38] = 't'; h[39] = 'a';
        writeIntLE(h, 40, pcmLen);
        fos.write(h);
    }

    private static void writeIntLE(byte[] b, int off, int v) {
        b[off] = (byte) (v & 0xff);
        b[off + 1] = (byte) ((v >> 8) & 0xff);
        b[off + 2] = (byte) ((v >> 16) & 0xff);
        b[off + 3] = (byte) ((v >> 24) & 0xff);
    }

    private static void writeShortLE(byte[] b, int off, short v) {
        b[off] = (byte) (v & 0xff);
        b[off + 1] = (byte) ((v >> 8) & 0xff);
    }
}
