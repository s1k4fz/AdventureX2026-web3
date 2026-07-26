class XEngineRealtimeVoiceProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    const channel = input?.[0]
    if (channel?.length) {
      const samples = channel.slice().buffer
      this.port.postMessage({ type: 'audio', samples }, [samples])
    }
    return true
  }
}

registerProcessor(
  'xengine-realtime-voice-processor',
  XEngineRealtimeVoiceProcessor
)
