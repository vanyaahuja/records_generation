/* Downsample on the audio thread; send 100 ms PCM16 frames, never React updates. */
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frame = new Int16Array(1600); this.index = 0;
    this.sum = 0; this.count = 0; this.phase = 0;
    this.port.onmessage = () => this.flush();
  }
  flush() {
    if (!this.index) return;
    const frame = this.frame.slice(0, this.index);
    this.port.postMessage(frame.buffer, [frame.buffer]); this.index = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const ratio = sampleRate / 16000;
    for (const value of input) {
      this.sum += value; this.count++; this.phase++;
      if (this.phase >= ratio) {
        const sample = Math.max(-1, Math.min(1, this.sum / this.count));
        this.frame[this.index++] = Math.round(sample * 32767);
        this.phase -= ratio; this.sum = 0; this.count = 0;
        if (this.index === this.frame.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
