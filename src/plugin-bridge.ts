import { WebSocketServer, WebSocket } from "ws";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class PluginBridge {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  start(): void {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("listening", () => {
      process.stderr.write(`[figma-bridge] WebSocket server listening on ws://localhost:${this.port}\n`);
    });

    this.wss.on("connection", (ws) => {
      this.client = ws;
      process.stderr.write("[figma-bridge] Figma plugin connected\n");

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as { id: string; result?: unknown; error?: string };
          const pending = this.pending.get(msg.id);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(msg.id);
            if (msg.error !== undefined) pending.reject(new Error(msg.error || "Unknown plugin error"));
            else pending.resolve(msg.result);
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        this.client = null;
        process.stderr.write("[figma-bridge] Figma plugin disconnected\n");
      });
    });

    this.wss.on("error", (err) => {
      process.stderr.write(`[figma-bridge] Server error: ${err.message}\n`);
    });
  }

  get isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  async sendCommand(type: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected) {
      throw new Error(
        "Figma Bridge Plugin is not connected.\n" +
        "Steps: 1) Start MCP server  2) Open Figma  3) Run Bridge Plugin in Figma\n" +
        "The plugin UI will show 'Connected' when ready."
      );
    }

    const id = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Plugin command '${type}' timed out after 15s`));
      }, 15_000);

      this.pending.set(id, { resolve, reject, timeout });
      this.client!.send(JSON.stringify({ id, type, params }));
    });
  }
}
