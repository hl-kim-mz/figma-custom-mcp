import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PluginBridge } from "../plugin-bridge.js";

function toText(result: unknown): string {
  return JSON.stringify(result) ?? '{"error":"Plugin returned undefined result"}';
}

export function registerWriteTools(server: McpServer, bridge: PluginBridge): void {
  /**
   * execute_js — FAST PATH. Always prefer over individual tools for 2+ operations.
   */
  server.tool(
    "execute_js",
    [
      "⚡ FAST PATH — ALWAYS use this instead of calling individual tools (clone_node, update_text, etc.) more than once.",
      "A single execute_js replaces N sequential tool calls and eliminates all round-trip overhead.",
      "",
      "RULE: If the task requires 2 or more plugin operations, use execute_js — not individual tools.",
      "",
      "When to use execute_js (not individual tools):",
      "  - Clone / duplicate 2+ nodes",
      "  - Update text in multiple nodes",
      "  - Create a frame and add children",
      "  - Any sequence of 2+ Figma API calls",
      "",
      "Example — clone a list row 5 times with 8px gap:",
      "  const tmpl = await figma.getNodeByIdAsync('123:456');",
      "  const parent = await figma.getNodeByIdAsync('789:012');",
      "  const ids = [];",
      "  for (let i = 0; i < 5; i++) {",
      "    const c = tmpl.clone();",
      "    parent.appendChild(c);",
      "    c.y = tmpl.y + (i + 1) * (tmpl.height + 8);",
      "    ids.push(c.id);",
      "  }",
      "  return ids;",
      "",
      "Example — update text in 3 nodes at once:",
      "  const data = [['id1','Label A'],['id2','Label B'],['id3','Label C']];",
      "  for (const [id, text] of data) {",
      "    const n = await figma.getNodeByIdAsync(id);",
      "    await figma.loadFontAsync(n.fontName);",
      "    n.characters = text;",
      "  }",
      "  return 'done';",
      "",
      "The `figma` global is available. Code runs async-compatible.",
      "Return a value to get it back as JSON. Throw to signal an error.",
    ].join("\n"),
    {
      code: z.string().describe(
        "JS code to execute in the Figma plugin sandbox. `figma` is injected. Use `return` to send back a result."
      ),
    },
    async ({ code }) => {
      const result = await bridge.sendCommand("EXECUTE_JS", { code });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * batch_clone
   * Clone a node N times in a single round-trip — replaces repeated clone_node calls.
   */
  server.tool(
    "batch_clone",
    [
      "Clone a node N times in ONE plugin round-trip.",
      "Use this instead of calling clone_node repeatedly.",
      "Clones are stacked below the template by default (offset_y = node height + gap).",
    ].join(" "),
    {
      node_id: z.string().describe("Template node ID to clone"),
      count: z.number().int().min(1).describe("Number of clones to create"),
      parent_id: z.string().optional().describe("Parent frame/group to place clones into (default: current page)"),
      offset_x: z.number().optional().describe("X offset per clone (default: 0)"),
      offset_y: z.number().optional().describe("Y offset per clone (default: node height + gap)"),
      gap: z.number().optional().describe("Gap in pixels between clones (default: 16)"),
      start_x: z.number().optional().describe("X of first clone (default: same as template)"),
      start_y: z.number().optional().describe("Y of first clone (default: below template)"),
    },
    async ({ node_id, count, parent_id, offset_x, offset_y, gap, start_x, start_y }) => {
      const result = await bridge.sendCommand("BATCH_CLONE", {
        nodeId: node_id,
        count,
        parentId: parent_id,
        offsetX: offset_x,
        offsetY: offset_y,
        gap,
        startX: start_x,
        startY: start_y,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * plugin_status
   */
  server.tool(
    "plugin_status",
    "Check if the Figma Bridge Plugin is connected and ready for write operations.",
    {},
    async () => ({
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          connected: bridge.isConnected,
          message: bridge.isConnected
            ? "Bridge Plugin connected — write tools are available."
            : "Not connected. Open Figma, run the Bridge Plugin from Plugins > Development, then retry.",
        }),
      }],
    })
  );

  /**
   * update_text
   */
  server.tool(
    "update_text",
    "Update the text content of a single TEXT node. For multiple nodes, use execute_js instead.",
    {
      node_id: z.string().describe("Figma node ID (from find_node)"),
      new_text: z.string().describe("New text content"),
    },
    async ({ node_id, new_text }) => {
      const result = await bridge.sendCommand("UPDATE_TEXT", { nodeId: node_id, text: new_text });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * set_fill
   */
  server.tool(
    "set_fill",
    "Set the fill color of a single node. For multiple nodes, use execute_js instead.",
    {
      node_id: z.string().describe("Figma node ID"),
      hex_color: z.string().describe("Hex color: #RRGGBB or #RRGGBBAA"),
    },
    async ({ node_id, hex_color }) => {
      const result = await bridge.sendCommand("SET_FILL", { nodeId: node_id, hexColor: hex_color });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * create_frame
   */
  server.tool(
    "create_frame",
    "Create a new empty frame on the current Figma page. To also add children, use execute_js instead.",
    {
      name: z.string().describe("Frame name"),
      width: z.number().describe("Width in pixels"),
      height: z.number().describe("Height in pixels"),
      x: z.number().optional().describe("X position (default 0)"),
      y: z.number().optional().describe("Y position (default 0)"),
    },
    async ({ name, width, height, x = 0, y = 0 }) => {
      const result = await bridge.sendCommand("CREATE_FRAME", { name, width, height, x, y });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * rename_node
   */
  server.tool(
    "rename_node",
    "Rename a single node in Figma. For multiple nodes, use execute_js instead.",
    {
      node_id: z.string().describe("Figma node ID"),
      new_name: z.string().describe("New name"),
    },
    async ({ node_id, new_name }) => {
      const result = await bridge.sendCommand("RENAME_NODE", { nodeId: node_id, name: new_name });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * move_node
   */
  server.tool(
    "move_node",
    "Move a single node to new coordinates. For multiple nodes, use execute_js instead.",
    {
      node_id: z.string().describe("Figma node ID"),
      x: z.number().describe("New X position"),
      y: z.number().describe("New Y position"),
    },
    async ({ node_id, x, y }) => {
      const result = await bridge.sendCommand("MOVE_NODE", { nodeId: node_id, x, y });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * resize_node
   */
  server.tool(
    "resize_node",
    "Resize a single node. For multiple nodes, use execute_js instead.",
    {
      node_id: z.string().describe("Figma node ID"),
      width: z.number().describe("New width in pixels"),
      height: z.number().describe("New height in pixels"),
    },
    async ({ node_id, width, height }) => {
      const result = await bridge.sendCommand("RESIZE_NODE", { nodeId: node_id, width, height });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * delete_node
   */
  server.tool(
    "delete_node",
    "Delete a node from Figma. This is irreversible — use carefully.",
    {
      node_id: z.string().describe("Figma node ID to delete"),
    },
    async ({ node_id }) => {
      const result = await bridge.sendCommand("DELETE_NODE", { nodeId: node_id });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * clone_node
   */
  server.tool(
    "clone_node",
    "Clone a single node. For cloning 2+ nodes, use batch_clone or execute_js instead.",
    {
      node_id: z.string().describe("Figma node ID to clone"),
      parent_id: z.string().optional().describe("Parent frame/group node ID (default: current page)"),
      x: z.number().optional().describe("X position of the clone"),
      y: z.number().optional().describe("Y position of the clone"),
    },
    async ({ node_id, parent_id, x, y }) => {
      const result = await bridge.sendCommand("CLONE_NODE", { nodeId: node_id, parentId: parent_id, x, y });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * create_instance
   */
  server.tool(
    "create_instance",
    "Create a single instance of a Figma COMPONENT. For multiple instances, use execute_js instead.",
    {
      component_id: z.string().describe("Component node ID (must be type COMPONENT, not INSTANCE)"),
      parent_id: z.string().optional().describe("Parent frame/group node ID (default: current page)"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
    },
    async ({ component_id, parent_id, x, y }) => {
      const result = await bridge.sendCommand("CREATE_INSTANCE", { componentId: component_id, parentId: parent_id, x, y });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * append_child
   */
  server.tool(
    "append_child",
    "Reparent a single node into a different frame or group. For multiple nodes, use execute_js instead.",
    {
      node_id: z.string().describe("Node ID to reparent"),
      parent_id: z.string().describe("Target parent frame/group node ID"),
      x: z.number().optional().describe("X position relative to new parent"),
      y: z.number().optional().describe("Y position relative to new parent"),
    },
    async ({ node_id, parent_id, x, y }) => {
      const result = await bridge.sendCommand("APPEND_CHILD", { nodeId: node_id, parentId: parent_id, x, y });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );
}
