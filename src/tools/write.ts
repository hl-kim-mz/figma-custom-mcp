import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PluginBridge } from "../plugin-bridge.js";

// Shared schema fragments
const batchCommon = {
  file_key: z.string().describe(
    "Figma file key from the URL: figma.com/file/FILE_KEY/..."
  ),
  scope_node_id: z.string().describe(
    "ID of the scope root node — must be FRAME or SECTION. All target nodes must be nested under this node in the Layers panel."
  ),
};

const PaintSchema = z
  .object({ type: z.string() })
  .passthrough()
  .describe("Figma Paint object (SOLID, GRADIENT_LINEAR, IMAGE, etc.)");

const EffectSchema = z
  .object({ type: z.string() })
  .passthrough()
  .describe("Figma Effect object (DROP_SHADOW, INNER_SHADOW, LAYER_BLUR, BACKGROUND_BLUR)");

function toText(result: unknown): string {
  return JSON.stringify(result) ?? '{"error":"Plugin returned undefined result"}';
}

export function registerWriteTools(
  server: McpServer,
  bridge: PluginBridge,
  options: { unsafeMode?: boolean } = {}
): void {
  const { unsafeMode = false } = options;

  // ── plugin_status ──────────────────────────────────────────────────────────
  server.tool(
    "plugin_status",
    "Check if the Figma Bridge Plugin is connected and ready for write operations.",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            connected: bridge.isConnected,
            unsafeMode,
            message: bridge.isConnected
              ? "Bridge Plugin connected — write tools are available."
              : "Not connected. Open Figma, run the Bridge Plugin from Plugins > Development, then retry.",
          }),
        },
      ],
    })
  );

  // ── get_file_key (diagnostic) ──────────────────────────────────────────────
  server.tool(
    "get_file_key",
    "Get the actual figma.fileKey from the currently open Figma file via Bridge Plugin.",
    {},
    async () => {
      const result = await bridge.sendCommand("GET_FILE_KEY", {});
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  // ── batch_create_nodes ─────────────────────────────────────────────────────
  server.tool(
    "batch_create_nodes",
    [
      "Create multiple nodes in a single all-or-nothing batch.",
      "All operations share the same scope root (file_key + scope_node_id).",
      "If any operation fails preflight, zero mutations are applied.",
      "Allowed create types: FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, COMPONENT.",
      "Parent must be FRAME, SECTION, or a local (non-library) COMPONENT/COMPONENT_SET.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            type: z
              .enum(["FRAME", "TEXT", "RECTANGLE", "ELLIPSE", "LINE", "COMPONENT"])
              .describe("Node type to create"),
            parent_node_id: z
              .string()
              .describe("Parent node ID — must be inside scope and satisfy parent policy"),
            name: z.string().describe("Name for the new node"),
            x: z.number().optional().describe("X position relative to parent"),
            y: z.number().optional().describe("Y position relative to parent"),
            width: z.number().optional().describe("Width in pixels"),
            height: z.number().optional().describe("Height in pixels"),
            characters: z
              .string()
              .optional()
              .describe("Initial text content (TEXT nodes only)"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_CREATE_NODES", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_create_instances ─────────────────────────────────────────────────
  server.tool(
    "batch_create_instances",
    [
      "Create multiple component instances in a single all-or-nothing batch.",
      "Source component must be accessible (local scope component or already imported).",
      "Library search/import is not performed — provide the exact component node ID.",
      "Parent must be inside scope and satisfy parent policy.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            source_component_node_id: z
              .string()
              .describe("Node ID of the source COMPONENT (not INSTANCE)"),
            parent_node_id: z
              .string()
              .describe("Parent node ID — must be inside scope and satisfy parent policy"),
            x: z.number().optional().describe("X position"),
            y: z.number().optional().describe("Y position"),
            component_properties: z
              .record(z.string(), z.unknown())
              .optional()
              .describe("Initial component property values"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_CREATE_INSTANCES", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_update_geometry ──────────────────────────────────────────────────
  server.tool(
    "batch_update_geometry",
    [
      "Update position, size, and rotation of multiple nodes in a single all-or-nothing batch.",
      "All target nodes must be inside the scope subtree.",
      "INSTANCE geometry is allowed. Direct writes to INSTANCE internal children are forbidden.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            node_id: z.string().describe("Target node ID — must be inside scope"),
            x: z.number().optional().describe("New X position"),
            y: z.number().optional().describe("New Y position"),
            width: z.number().optional().describe("New width in pixels"),
            height: z.number().optional().describe("New height in pixels"),
            rotation: z.number().optional().describe("Rotation in degrees"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_UPDATE_GEOMETRY", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_update_auto_layout ───────────────────────────────────────────────
  server.tool(
    "batch_update_auto_layout",
    [
      "Update auto-layout properties on multiple FRAME nodes in a single all-or-nothing batch.",
      "Target nodes must be FRAME type and inside the scope subtree.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            node_id: z.string().describe("Target FRAME node ID — must be inside scope"),
            layout_mode: z
              .enum(["NONE", "HORIZONTAL", "VERTICAL"])
              .optional()
              .describe("Auto-layout direction"),
            primary_axis_align_items: z
              .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
              .optional()
              .describe("Alignment on primary axis"),
            counter_axis_align_items: z
              .enum(["MIN", "CENTER", "MAX", "BASELINE"])
              .optional()
              .describe("Alignment on counter axis"),
            item_spacing: z.number().optional().describe("Gap between items (px)"),
            padding: z
              .object({
                top: z.number(),
                right: z.number(),
                bottom: z.number(),
                left: z.number(),
              })
              .optional()
              .describe("Padding on all sides"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_UPDATE_AUTO_LAYOUT", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_update_text ──────────────────────────────────────────────────────
  server.tool(
    "batch_update_text",
    [
      "Update text content and typography on multiple TEXT nodes in a single all-or-nothing batch.",
      "All target nodes must be TEXT type and inside the scope subtree.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            node_id: z.string().describe("Target TEXT node ID — must be inside scope"),
            characters: z.string().describe("New text content"),
            font_size: z.number().optional().describe("Font size in pixels"),
            font_name: z
              .object({ family: z.string(), style: z.string() })
              .optional()
              .describe('Font family and style e.g. { family: "Inter", style: "Bold" }'),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_UPDATE_TEXT", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_update_fills_strokes_effects ─────────────────────────────────────
  server.tool(
    "batch_update_fills_strokes_effects",
    [
      "Update fills, strokes, and effects on multiple nodes in a single all-or-nothing batch.",
      "All target nodes must be inside the scope subtree and support the modified properties.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            node_id: z.string().describe("Target node ID — must be inside scope"),
            fills: z.array(PaintSchema).optional().describe("Array of fill paints"),
            strokes: z.array(PaintSchema).optional().describe("Array of stroke paints"),
            stroke_weight: z.number().optional().describe("Stroke weight in pixels"),
            effects: z.array(EffectSchema).optional().describe("Array of effects"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_UPDATE_FILLS_STROKES_EFFECTS", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_bind_variables ───────────────────────────────────────────────────
  server.tool(
    "batch_bind_variables",
    [
      "Bind or unbind Figma variables to node properties in a single all-or-nothing batch.",
      "All target nodes must be inside the scope subtree.",
      "Set variable_id to null to unbind a property.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            node_id: z.string().describe("Target node ID — must be inside scope"),
            bindings: z.array(
              z.object({
                property: z
                  .string()
                  .describe("Node property to bind e.g. 'opacity', 'width', 'height'"),
                variable_id: z
                  .string()
                  .nullable()
                  .describe("Variable ID to bind, or null to unbind"),
              })
            ).describe("List of property-variable bindings"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_BIND_VARIABLES", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_update_component_properties ─────────────────────────────────────
  server.tool(
    "batch_update_component_properties",
    [
      "Update exposed component properties on INSTANCE nodes in a single all-or-nothing batch.",
      "All target nodes must be INSTANCE type and inside the scope subtree.",
      "Modifies instance overrides, not the source component definition.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            node_id: z.string().describe("Target INSTANCE node ID — must be inside scope"),
            properties: z
              .record(z.string(), z.unknown())
              .describe("Component property values to set e.g. { 'Button Text': 'Submit' }"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_UPDATE_COMPONENT_PROPERTIES", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── batch_reorder_move ─────────────────────────────────────────────────────
  server.tool(
    "batch_reorder_move",
    [
      "Reorder and/or reparent nodes in a single all-or-nothing batch.",
      "All source nodes must be inside scope.",
      "New parent (if provided) must also be inside scope and satisfy parent policy.",
    ].join(" "),
    {
      ...batchCommon,
      operations: z
        .array(
          z.object({
            node_id: z.string().describe("Node to reorder/reparent — must be inside scope"),
            new_parent_node_id: z
              .string()
              .optional()
              .describe("New parent node ID — must be inside scope and satisfy parent policy"),
            new_index: z
              .number()
              .int()
              .min(0)
              .optional()
              .describe("Target index within new (or current) parent (0 = front/bottom)"),
            x: z.number().optional().describe("New X position after move"),
            y: z.number().optional().describe("New Y position after move"),
          })
        )
        .max(100)
        .describe("Operations to execute — max 100"),
    },
    async ({ file_key, scope_node_id, operations }) => {
      const result = await bridge.sendCommand("BATCH_REORDER_MOVE", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        operations,
      });
      return { content: [{ type: "text" as const, text: toText(result) }] };
    }
  );

  // ── execute_js (UNSAFE_MODE only) ──────────────────────────────────────────
  if (unsafeMode) {
    server.tool(
      "execute_js",
      [
        "⚠️  Developer mode only — executes arbitrary JavaScript in the Figma plugin sandbox.",
        "Only available when UNSAFE_MODE=true is set on the MCP server.",
        "The `figma` global is injected. Use `return` to send back a result.",
        "Bypasses all safe-mode restrictions (scope, parent policy, destructive operation guards).",
      ].join("\n"),
      {
        code: z.string().describe(
          "JS code to execute in the Figma plugin sandbox. `figma` is injected."
        ),
      },
      async ({ code }) => {
        const result = await bridge.sendCommand("EXECUTE_JS", {
          code,
          unsafeMode: true,
        });
        return { content: [{ type: "text" as const, text: toText(result) }] };
      }
    );
  }
}
