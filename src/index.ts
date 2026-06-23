import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FigmaRestClient } from "./figma-rest.js";
import { PluginBridge } from "./plugin-bridge.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

const FIGMA_TOKEN = process.env.FIGMA_TOKEN ?? "";
const WS_PORT = parseInt(process.env.WS_PORT ?? "3055", 10);
const UNSAFE_MODE = process.env.UNSAFE_MODE === "true";

if (!FIGMA_TOKEN) {
  process.stderr.write("[figma-custom-mcp] WARNING: FIGMA_TOKEN not set — read tools will fail.\n");
}
if (UNSAFE_MODE) {
  process.stderr.write("[figma-custom-mcp] WARNING: UNSAFE_MODE enabled — execute_js is active. Use only in trusted developer environments.\n");
}

const server = new McpServer({
  name: "figma-custom-mcp",
  version: "1.0.0",
});

const figmaClient = new FigmaRestClient(FIGMA_TOKEN);
const bridge = new PluginBridge(WS_PORT);

// Start WebSocket server (for Figma Bridge Plugin write operations)
bridge.start();

// Register all tools
registerReadTools(server, figmaClient, bridge);
registerWriteTools(server, bridge, { unsafeMode: UNSAFE_MODE });

// Connect via stdio transport (used by Claude Code MCP)
const transport = new StdioServerTransport();
await server.connect(transport);
