import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FigmaRestClient } from "../figma-rest.js";
import type { PluginBridge } from "../plugin-bridge.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

interface TextEntry {
  path: string;
  id: string;
  content: string;
  style: { fontFamily?: string; fontSize?: number; fontWeight?: number };
}

function extractTextNodes(node: any, path = ""): TextEntry[] {
  const cur = path ? `${path}/${node.name}` : node.name;
  const results: TextEntry[] = [];

  if (node.type === "TEXT" && node.characters) {
    results.push({
      path: cur,
      id: node.id,
      content: node.characters,
      style: {
        fontFamily: node.style?.fontFamily,
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
      },
    });
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      results.push(...extractTextNodes(child, cur));
    }
  }

  return results;
}

function summarizePage(page: any) {
  return {
    id: page.id,
    name: page.name,
    frameCount: (page.children ?? []).length,
    frames: (page.children ?? []).map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      childCount: (f.children ?? []).length,
      bounds: f.absoluteBoundingBox ?? null,
    })),
  };
}

// ── Tool registration ──────────────────────────────────────────────────────────

export function registerReadTools(server: McpServer, figma: FigmaRestClient, bridge?: PluginBridge): void {
  /**
   * get_node_tree
   * Reads the current page structure DIRECTLY from the live Figma plugin — no REST API call.
   * Much faster than get_page_structure when the plugin is connected.
   */
  server.tool(
    "get_node_tree",
    [
      "⚡ FAST — Read current page structure directly from the live Figma plugin (no REST API).",
      "Use this instead of get_page_structure when the bridge plugin is connected.",
      "Returns the node tree of the currently open Figma page up to the specified depth.",
      "Optionally scope to a specific node by node_id.",
    ].join(" "),
    {
      depth: z.number().int().min(1).max(6).optional().describe("Tree depth to traverse (default: 3)"),
      node_id: z.string().optional().describe("Scope to a specific node ID (default: entire current page)"),
    },
    async ({ depth = 3, node_id }) => {
      if (!bridge?.isConnected) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: "Bridge Plugin not connected. Use get_page_structure (REST) instead, or connect the plugin." }),
          }],
        };
      }
      const result = await bridge.sendCommand("GET_NODE_TREE", { depth, nodeId: node_id });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  /**
   * get_page_structure
   * GWS-style: returns compact hierarchy. Results cached 30s to avoid repeated full-file downloads.
   */
  server.tool(
    "get_page_structure",
    [
      "Get the page/frame hierarchy of a Figma file via REST API.",
      "Results are cached for 30 seconds — repeated calls are instant.",
      "Prefer get_node_tree when the bridge plugin is connected (no network call).",
    ].join(" "),
    {
      file_key: z.string().describe("Figma file key — found in the URL: figma.com/file/FILE_KEY/..."),
      page_name: z.string().optional().describe("Filter by page name (partial match). Omit to return all pages."),
    },
    async ({ file_key, page_name }) => {
      const file = await figma.getFile(file_key);
      const pages: any[] = file.document?.children ?? [];

      const filtered = page_name
        ? pages.filter((p: any) => p.name.toLowerCase().includes(page_name.toLowerCase()))
        : pages;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            fileName: file.name,
            lastModified: file.lastModified,
            totalPages: filtered.length,
            pages: filtered.map(summarizePage),
          }, null, 2),
        }],
      };
    }
  );

  /**
   * get_all_text
   * Extracts every text node. File cached 30s.
   */
  server.tool(
    "get_all_text",
    "Extract all text nodes from a Figma file (or scoped to a page/frame). Returns path + content + style per node. File is cached for 30s.",
    {
      file_key: z.string().describe("Figma file key"),
      page_name: z.string().optional().describe("Scope to a specific page (partial match)"),
      frame_name: z.string().optional().describe("Further scope to a specific frame within the page (partial match)"),
    },
    async ({ file_key, page_name, frame_name }) => {
      const file = await figma.getFile(file_key);
      const pages: any[] = file.document?.children ?? [];

      const targetPages = page_name
        ? pages.filter((p: any) => p.name.toLowerCase().includes(page_name.toLowerCase()))
        : pages;

      const texts: TextEntry[] = [];

      for (const page of targetPages) {
        const topNodes: any[] = frame_name
          ? (page.children ?? []).filter((n: any) => n.name.toLowerCase().includes(frame_name.toLowerCase()))
          : (page.children ?? []);

        for (const node of topNodes) {
          texts.push(...extractTextNodes(node, page.name));
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ total: texts.length, texts }, null, 2),
        }],
      };
    }
  );

  /**
   * list_components
   */
  server.tool(
    "list_components",
    "List all components in a Figma file with their names, IDs, and descriptions. File is cached for 30s.",
    {
      file_key: z.string().describe("Figma file key"),
    },
    async ({ file_key }) => {
      const file = await figma.getFile(file_key);
      const raw: Record<string, any> = file.components ?? {};

      const components = Object.entries(raw).map(([id, c]) => ({
        id,
        name: c.name as string,
        description: c.description as string,
        key: c.key as string,
        componentSetId: c.componentSetId as string | undefined,
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ total: components.length, components }, null, 2),
        }],
      };
    }
  );

  /**
   * get_design_tokens
   */
  server.tool(
    "get_design_tokens",
    "Extract design tokens (colors, typography, spacing) from Figma local variables and styles.",
    {
      file_key: z.string().describe("Figma file key"),
    },
    async ({ file_key }) => {
      const [vars, stylesData] = await Promise.all([
        figma.getLocalVariables(file_key).catch(() => ({ variables: {}, variableCollections: {} })),
        figma.getStyles(file_key).catch(() => ({ styles: {} })),
      ]);

      const collections: Record<string, any> = vars.variableCollections ?? {};
      const variables: Record<string, any> = vars.variables ?? {};

      const tokensByCollection: Record<string, any[]> = {};
      for (const [, variable] of Object.entries(variables)) {
        const v = variable as any;
        const collName: string = collections[v.variableCollectionId]?.name ?? "Unknown";
        (tokensByCollection[collName] ??= []).push({
          name: v.name,
          type: v.resolvedType,
          values: v.valuesByMode,
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            tokens: tokensByCollection,
            styles: stylesData.styles ?? {},
          }, null, 2),
        }],
      };
    }
  );

  /**
   * find_node
   */
  server.tool(
    "find_node",
    "Find nodes by name in a Figma file. Returns node IDs required for write tools. File is cached for 30s — call once then reuse IDs.",
    {
      file_key: z.string().describe("Figma file key"),
      node_name: z.string().describe("Node name to search (partial, case-insensitive)"),
      page_name: z.string().optional().describe("Scope to a specific page (partial match)"),
      limit: z.number().optional().describe("Max results to return (default: 20)"),
    },
    async ({ file_key, node_name, page_name, limit = 20 }) => {
      const file = await figma.getFile(file_key);
      const pages: any[] = file.document?.children ?? [];

      const targetPages = page_name
        ? pages.filter((p: any) => p.name.toLowerCase().includes(page_name.toLowerCase()))
        : pages;

      const results: any[] = [];
      const needle = node_name.toLowerCase();

      function search(node: any, path: string) {
        if (results.length >= limit) return;
        const cur = path ? `${path}/${node.name}` : node.name;
        if (node.name.toLowerCase().includes(needle)) {
          results.push({
            id: node.id,
            name: node.name,
            type: node.type,
            path: cur,
            bounds: node.absoluteBoundingBox ?? null,
            ...(node.characters ? { characters: node.characters } : {}),
          });
        }
        if (Array.isArray(node.children)) {
          for (const child of node.children) search(child, cur);
        }
      }

      for (const page of targetPages) {
        for (const child of (page.children ?? [])) {
          search(child, page.name);
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ found: results.length, nodes: results }, null, 2),
        }],
      };
    }
  );

  /**
   * inspect_scope_tree
   * Read-only scope tree inspection. Returns scope root info, descendant count,
   * instance/component markers, and optionally allowed parent candidates.
   */
  server.tool(
    "inspect_scope_tree",
    [
      "Read-only helper to inspect a scope subtree before writing.",
      "Returns scope root info, descendant count, instance boundaries, and local/external component markers.",
      "Use include_allowed_parents=true to see which nodes can receive new children.",
      "Helps diagnose OUT_OF_SCOPE_NODE and INVALID_PARENT_NODE errors.",
      "Always includes timing metrics.",
    ].join(" "),
    {
      file_key: z.string().describe(
        "Figma file key — must match the currently open file"
      ),
      scope_node_id: z.string().describe(
        "ID of the scope root node (must be FRAME or SECTION)"
      ),
      include_allowed_parents: z
        .boolean()
        .optional()
        .describe("Include isAllowedParent flag on each node (default: false)"),
      max_depth: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Tree depth to traverse (default: 3, max: 10)"),
    },
    async ({ file_key, scope_node_id, include_allowed_parents = false, max_depth = 3 }) => {
      if (!bridge?.isConnected) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "error",
              code: "BRIDGE_NOT_CONNECTED",
              message: "Bridge Plugin not connected. Open Figma and run the Bridge Plugin.",
            }),
          }],
        };
      }
      const result = await bridge.sendCommand("GET_SCOPE_TREE", {
        fileKey: file_key,
        scopeNodeId: scope_node_id,
        includeAllowedParents: include_allowed_parents,
        maxDepth: max_depth,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
