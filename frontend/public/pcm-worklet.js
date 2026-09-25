// AudioWorklet: mono mixdown + resample to 16 kHz + Int16 PCM in 100 ms frames.
class PcmWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options.processorOptions?.targetRate || 16000;
    this.ratio = sampleRate / this.target; // input samples per output sample
    this.pos = 0; // fractional read position into the carry buffer
    this.carry = new Float32Array(0);
    this.frame = new Int16Array(this.target / 10);
    this.filled = 0;
    this.peak = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const n = input[0].length;
    const mono = new Float32Array(this.carry.length + n);
    mono.set(this.carry);
    for (let c = 0; c < input.length; c++) {
      const ch = input[c];
      for (let i = 0; i < n; i++) mono[this.carry.length + i] += ch[i] / input.length;
    }
    while (this.pos + 1 < mono.length) {
      const i = Math.floor(this.pos), f = this.pos - i;
      const s = Math.max(-1, Math.min(1, mono[i] * (1 - f) + mono[i + 1] * f));
      this.peak = Math.max(this.peak, Math.abs(s));
      this.frame[this.filled++] = s * 32767;
      if (this.filled === this.frame.length) {
        this.port.postMessage({ pcm: this.frame.buffer, peak: this.peak }, [this.frame.buffer]);
        this.frame = new Int16Array(this.target / 10);
        this.filled = 0; this.peak = 0;
      }
      this.pos += this.ratio;
    }
    const keep = Math.floor(this.pos);
    this.carry = mono.slice(keep);
    this.pos -= keep;
    return true;
  }
}
registerProcessor("pcm-worklet", PcmWorklet);
