import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PluginBridge } from "../plugin-bridge.js";

function toText(result: unknown): string {
  return JSON.stringify(result) ?? '{"error":"Plugin returned undefined result"}';
}

export function registerWriteTools(server: McpServer, bridge: PluginBridge): void {
  /**
   * plugin_status
   * Always check this before calling write tools.
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
    "Update the text content of a TEXT node. Get the node_id first with find_node.",
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
    "Set the fill color of a node. Accepts hex color (e.g. #FF5A00 or #FF5A00CC with alpha).",
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
    "Create a new empty frame on the current Figma page.",
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
    "Rename a node in Figma.",
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
    "Move a node to new absolute coordinates within the current page.",
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
    "Resize a node (frame, component, shape) in Figma.",
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
    "Clone (duplicate) any Figma node — frame, instance, component, group, etc. Optionally place into a parent frame and set position.",
    {
      node_id: z.string().describe("Figma node ID to clone"),
      parent_id: z.string().optional().describe("Parent frame/group node ID to place the clone into (default: current page)"),
      x: z.number().optional().describe("X position of the clone (relative to parent if parent_id given)"),
      y: z.number().optional().describe("Y position of the clone (relative to parent if parent_id given)"),
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
    "Create an instance of a Figma COMPONENT node. Use list_components to find component IDs.",
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
   * execute_js
   */
  server.tool(
    "execute_js",
    [
      "Execute arbitrary Figma Plugin API code in the plugin sandbox.",
      "The `figma` global is available. Code runs async-compatible.",
      "Use this for complex multi-step operations that cannot be expressed with individual tools.",
      "Examples:",
      "  - Find all nodes by name pattern and batch-update properties",
      "  - Traverse the node tree and collect data",
      "  - Create multiple nodes and wire them together in one call",
      "Return a value to get it back as JSON. Throw to signal an error.",
      "Available globals: figma, figma.currentPage, figma.getNodeByIdAsync(), figma.createFrame(), etc.",
    ].join("\n"),
    {
      code: z.string().describe(
        "JS code string to execute. The `figma` object is injected. Use `return` to send back a result."
      ),
    },
    async ({ code }) => {
      const result = await bridge.sendCommand("EXECUTE_JS", { code });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  /**
   * append_child
   */
  server.tool(
    "append_child",
    "Reparent a node — move it into a different frame or group. Optionally set position after reparenting.",
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
