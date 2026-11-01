type LiveMessage = {
  type: string;
  transcript?: string;
  text?: string;
  inference_ms?: number;
  rtf?: number;
  message?: string;
  events?: unknown[];
};

/** PCM frames avoid repeatedly uploading/decoding an ever-growing WebM file. */
export class LiveAudio {
  private socket?: WebSocket;
  private stream?: MediaStream;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private stopping = false;
  private complete = false;
  constructor(
    private onMessage: (message: LiveMessage) => void,
    private onError: (message: string) => void,
  ) {}
  async start() {
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`,
    );
    this.socket = ws;
    ws.onmessage = async ({ data }) => {
      const message = JSON.parse(data) as LiveMessage;
      if (message.type === "ready") {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
            },
          });
          if (this.stopping) {
            this.release();
            return;
          }
          this.context = new AudioContext({ latencyHint: "interactive" });
          await this.context.audioWorklet.addModule("/pcm-worklet.js");
          this.node = new AudioWorkletNode(this.context, "pcm-capture");
          this.node.port.onmessage = ({
            data: frame,
          }: MessageEvent<ArrayBuffer>) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (ws.bufferedAmount > 64000) {
              this.onError(
                "Audio connection is falling behind. Stop and retry.",
              );
              this.close();
              return;
            }
            ws.send(frame);
          };
          this.context.createMediaStreamSource(this.stream).connect(this.node);
          this.node.connect(this.context.destination);
          await this.context.resume();
        } catch (error) {
          this.onError((error as Error).message);
          this.close();
          return;
        }
      }
      if (message.type === "error") {
        this.onError(message.message || "Speech failed");
        this.close();
      }
      if (message.type === "complete") {
        this.complete = true;
        this.release();
      }
      this.onMessage(message);
    };
    ws.onerror = async () => {
      // Readiness distinguishes a model/startup problem from a failed WS proxy.
      this.close();
      let message =
        "Cannot reach local speech. Check the ASR container logs and retry.";
      try {
        const response = await fetch("/api/speech/status", {
          signal: AbortSignal.timeout(5000),
          cache: "no-store",
        });
        if (response.ok) {
          const status = await response.json();
          message = status.ready
            ? "Speech is ready, but the streaming connection failed. Open http://127.0.0.1:8080 directly in your browser and retry; check WebSocket proxy and allowed-origin settings."
            : "Speech is still initializing or its model could not load. Check the ASR container logs and retry.";
        }
      } catch {
        /* The original connection failure remains the useful error. */
      }
      this.onError(message);
    };
    ws.onclose = () => {
      if (!this.complete && !this.stopping)
        this.onError("Speech connection closed. Finalized text is preserved.");
      this.release();
    };
  }
  async stop() {
    this.stopping = true;
    this.node?.port.postMessage("flush");
    // Let the worklet deliver its final PCM frame before the stop sentinel.
    await new Promise((resolve) => setTimeout(resolve, 120));
    this.release();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send("stop");
  }
  private release() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.node?.disconnect();
    if (this.context && this.context.state !== "closed")
      void this.context.close();
  }
  close() {
    this.stopping = true;
    this.release();
    this.socket?.close();
  }
}
