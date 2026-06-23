// MCP Bridge Plugin — main thread (plugin sandbox)
// Implements safe batch operations per figma-custom-mcp policy v1
// All write operations require file_key + scope_node_id; destructive ops are blocked in safe mode.

figma.showUI(__html__, { width: 300, height: 180, title: "MCP Bridge" });

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_BATCH_SIZE = 100;
const MAX_SCOPE_DEPTH = 10;
const MCP_NAMESPACE = "figma-custom-mcp";

const ALLOWED_CREATE_TYPES = new Set([
  "FRAME", "TEXT", "RECTANGLE", "ELLIPSE", "LINE", "COMPONENT",
]);

const ALLOWED_PARENT_TYPES = new Set(["FRAME", "SECTION"]);

const FORBIDDEN_PARENT_TYPES = new Set([
  "TEXT", "RECTANGLE", "ELLIPSE", "LINE", "STAR", "POLYGON",
  "INSTANCE", "GROUP", "VECTOR", "BOOLEAN_OPERATION",
]);

// ── Envelope helpers ───────────────────────────────────────────────────────────

function makeEnvelope(status, code, message, details, timing, nextAction) {
  return {
    status,
    code,
    message: message || code,
    details: Object.assign({ appliedCount: status === "write_applied" ? (details.appliedCount != null ? details.appliedCount : 0) : 0 }, details),
    timing: timing || { totalMs: 0 },
    nextAction: nextAction || "",
  };
}

function errorEnvelope(code, message, details, timing, nextAction) {
  return makeEnvelope(
    "error",
    code,
    message,
    Object.assign({ appliedCount: 0 }, details || {}),
    timing || { totalMs: 0 },
    nextAction || ""
  );
}

// ── Scope / tree helpers ───────────────────────────────────────────────────────

/**
 * Returns true if `node` IS the scope root or is nested under it in the Layers panel.
 * Scope membership is based on real Figma layer tree, not visual overlap.
 */
function isNodeInScope(node, scopeNodeId) {
  if (node.id === scopeNodeId) return true;
  let cur = node.parent;
  while (cur) {
    if (cur.id === scopeNodeId) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * Returns an error code if `parentNode` cannot accept new children per parent policy,
 * or null if it is allowed.
 *
 * Allowed parents: FRAME, SECTION, local (non-remote) COMPONENT, local COMPONENT_SET
 * Forbidden parents: TEXT, shape nodes, INSTANCE, GROUP, external/library components
 */
function validateParentType(parentNode) {
  if (FORBIDDEN_PARENT_TYPES.has(parentNode.type)) return "INVALID_PARENT_NODE";
  if (parentNode.type === "COMPONENT" || parentNode.type === "COMPONENT_SET") {
    if (parentNode.remote === true) return "EXTERNAL_COMPONENT_WRITE_FORBIDDEN";
    return null; // local editable component — ok
  }
  if (ALLOWED_PARENT_TYPES.has(parentNode.type)) return null;
  return "INVALID_PARENT_NODE";
}

function isLocalEditableComponent(node) {
  return (
    (node.type === "COMPONENT" || node.type === "COMPONENT_SET") &&
    node.remote !== true
  );
}

/**
 * Returns INSTANCE_CHILD_WRITE_FORBIDDEN if `node` has an INSTANCE ancestor
 * before reaching `scopeNodeId`. The node itself is not checked (INSTANCE nodes
 * themselves may be modified for geometry and component properties).
 */
function checkInstanceChildWrite(node, scopeNodeId) {
  let cur = node.parent;
  while (cur && cur.id !== scopeNodeId) {
    if (cur.type === "INSTANCE") return "INSTANCE_CHILD_WRITE_FORBIDDEN";
    cur = cur.parent;
  }
  return null;
}

// ── Shared preflight (steps 1–4) ───────────────────────────────────────────────

/**
 * Runs preflight steps 1–4 (fail-fast):
 *  1. file_key matches currently open file
 *  2. scopeNodeId exists and is FRAME | SECTION
 *  3. all nodeIds exist
 *  4. all nodeIds are inside the scope subtree
 *
 * @returns { ok: true, scopeNode, resolvedNodes } on success
 *          { error, message, failedOperationIndex? } on failure
 */
async function runPreflight(fileKey, scopeNodeId, nodeIds) {
  // Step 1 — skip check if figma.fileKey is undefined (dev plugin context)
  if (figma.fileKey != null && figma.fileKey !== fileKey) {
    return {
      error: "FILE_KEY_MISMATCH",
      message: `file_key does not match the currently open Figma file. Expected: ${figma.fileKey}`,
    };
  }

  // Step 2
  const scopeNode = await figma.getNodeByIdAsync(scopeNodeId);
  if (!scopeNode) {
    return { error: "INVALID_SCOPE_ROOT_TYPE", message: `Scope node '${scopeNodeId}' not found.` };
  }
  if (scopeNode.type !== "FRAME" && scopeNode.type !== "SECTION") {
    return {
      error: "INVALID_SCOPE_ROOT_TYPE",
      message: `Scope root must be FRAME or SECTION (got ${scopeNode.type}). Check Layers panel nesting, not visual overlap.`,
    };
  }

  // Steps 3 + 4
  const resolvedNodes = [];
  for (let i = 0; i < nodeIds.length; i++) {
    const id = nodeIds[i];
    const node = await figma.getNodeByIdAsync(id);
    if (!node) {
      return {
        error: "NODE_NOT_FOUND",
        message: `Node '${id}' not found (operation index ${i}).`,
        failedOperationIndex: i,
      };
    }
    if (!isNodeInScope(node, scopeNodeId)) {
      return {
        error: "OUT_OF_SCOPE_NODE",
        message: `Node '${node.name}' (${id}) is not inside scope '${scopeNodeId}'. Scope is based on Layers panel nesting, not visual overlap.`,
        failedOperationIndex: i,
      };
    }
    resolvedNodes.push(node);
  }

  return { ok: true, scopeNode, resolvedNodes };
}

// ── Message handler ────────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg) => {
  const { id, type, params } = msg;

  async function run() {
    const t0 = Date.now();

    // ── Read: GET_NODE_TREE ──────────────────────────────────────────────────
    if (type === "GET_NODE_TREE") {
      const maxDepth = params.depth != null ? params.depth : 3;

      function summarize(node, depth) {
        const out = { id: node.id, name: node.name, type: node.type };
        if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
          out.bounds = node.absoluteBoundingBox;
        }
        if (depth < maxDepth && "children" in node && node.children.length > 0) {
          out.children = node.children.map((c) => summarize(c, depth + 1));
          out.childCount = node.children.length;
        } else if ("children" in node) {
          out.childCount = node.children.length;
        }
        return out;
      }

      if (params.nodeId) {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        return summarize(node, 0);
      }

      const page = figma.currentPage;
      return {
        pageId: page.id,
        pageName: page.name,
        childCount: page.children.length,
        children: page.children.map((c) => summarize(c, 1)),
      };
    }

    // ── Read: GET_FILE_KEY (diagnostic) ─────────────────────────────────────
    if (type === "GET_FILE_KEY") {
      return { fileKey: figma.fileKey };
    }

    // ── Read: GET_SCOPE_TREE ─────────────────────────────────────────────────
    if (type === "GET_SCOPE_TREE") {
      if (figma.fileKey != null && figma.fileKey !== params.fileKey) {
        return errorEnvelope("FILE_KEY_MISMATCH", `file_key does not match the currently open file. Expected: ${figma.fileKey}`, {}, { totalMs: Date.now() - t0 });
      }
      const scopeNode = await figma.getNodeByIdAsync(params.scopeNodeId);
      if (!scopeNode) {
        return errorEnvelope("INVALID_SCOPE_ROOT_TYPE", `Scope node '${params.scopeNodeId}' not found.`, {}, { totalMs: Date.now() - t0 });
      }
      if (scopeNode.type !== "FRAME" && scopeNode.type !== "SECTION") {
        return errorEnvelope("INVALID_SCOPE_ROOT_TYPE", `Scope root must be FRAME or SECTION (got ${scopeNode.type}).`, {}, { totalMs: Date.now() - t0 });
      }

      const maxDepth = Math.min(params.maxDepth != null ? params.maxDepth : 3, MAX_SCOPE_DEPTH);
      const includeAllowedParents = params.includeAllowedParents === true;

      function summarizeForScope(node, depth) {
        const isLocalComp = isLocalEditableComponent(node);
        const isExtComp =
          (node.type === "COMPONENT" || node.type === "COMPONENT_SET") && node.remote === true;
        const out = {
          id: node.id,
          name: node.name,
          type: node.type,
          isInstance: node.type === "INSTANCE",
          isLocalEditableComponent: isLocalComp,
          isExternalComponent: isExtComp,
          childCount: "children" in node ? node.children.length : 0,
        };
        if (includeAllowedParents && "children" in node) {
          out.isAllowedParent = validateParentType(node) === null;
        }
        if (depth < maxDepth && "children" in node && node.children.length > 0) {
          out.children = node.children.map((c) => summarizeForScope(c, depth + 1));
        }
        return out;
      }

      return {
        status: "needs_user_review",
        code: "OK",
        message: "Scope tree retrieved.",
        details: { scopeRoot: summarizeForScope(scopeNode, 0) },
        timing: { totalMs: Date.now() - t0 },
        nextAction: "",
      };
    }

    // ── BATCH_CREATE_NODES ───────────────────────────────────────────────────
    if (type === "BATCH_CREATE_NODES") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE} (got ${ops.length}).`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const parentIds = ops.map((op) => op.parent_node_id);
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, parentIds);
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Step 5–6: type and parent type validation (all before mutation)
      for (let i = 0; i < ops.length; i++) {
        if (!ALLOWED_CREATE_TYPES.has(ops[i].type)) {
          return errorEnvelope("INVALID_CREATE_TYPE", `Node type '${ops[i].type}' is not allowed. Allowed: ${[...ALLOWED_CREATE_TYPES].join(", ")}.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre }, "remove_invalid_operations_and_retry");
        }
      }
      for (let i = 0; i < ops.length; i++) {
        const parentNode = pre.resolvedNodes[i];
        const err = validateParentType(parentNode);
        if (err) {
          return errorEnvelope(err, `Parent '${parentNode.name}' (${parentNode.type}) is not an allowed parent. Allowed: FRAME, SECTION, local COMPONENT/COMPONENT_SET. (Layers panel nesting, not visual overlap.)`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre }, "remove_invalid_parent_and_retry");
        }
      }

      const tMut = Date.now();
      const created = [];

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const parentNode = pre.resolvedNodes[i];
        let node;

        switch (op.type) {
          case "FRAME":
            node = figma.createFrame();
            break;
          case "TEXT":
            await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            node = figma.createText();
            if (op.characters) node.characters = op.characters;
            break;
          case "RECTANGLE":
            node = figma.createRectangle();
            break;
          case "ELLIPSE":
            node = figma.createEllipse();
            break;
          case "LINE":
            node = figma.createLine();
            break;
          case "COMPONENT":
            node = figma.createComponent();
            node.setSharedPluginData(MCP_NAMESPACE, "managed", "true");
            node.setSharedPluginData(MCP_NAMESPACE, "createdBy", MCP_NAMESPACE);
            node.setSharedPluginData(MCP_NAMESPACE, "schemaVersion", "1");
            break;
        }

        if (op.name) node.name = op.name;
        parentNode.appendChild(node);
        if (op.x != null) node.x = op.x;
        if (op.y != null) node.y = op.y;
        if ((op.width != null || op.height != null) && "resize" in node) {
          node.resize(op.width != null ? op.width : (node.width || 100), op.height != null ? op.height : (node.height || 100));
        }

        created.push({ nodeId: node.id, name: node.name, type: node.type });
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Created ${created.length} node(s).`, { appliedCount: created.length, created }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_CREATE_INSTANCES ───────────────────────────────────────────────
    if (type === "BATCH_CREATE_INSTANCES") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE} (got ${ops.length}).`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const parentIds = ops.map((op) => op.parent_node_id);
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, parentIds);
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Validate parents + resolve source components (all before mutation)
      const resolvedSources = [];
      for (let i = 0; i < ops.length; i++) {
        const parentNode = pre.resolvedNodes[i];
        const parentErr = validateParentType(parentNode);
        if (parentErr) {
          return errorEnvelope(parentErr, `Parent '${parentNode.name}' (${parentNode.type}) is not an allowed parent.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
        }
        const src = await figma.getNodeByIdAsync(ops[i].source_component_node_id);
        if (!src || src.type !== "COMPONENT") {
          return errorEnvelope("SOURCE_COMPONENT_NOT_ACCESSIBLE", `Source component '${ops[i].source_component_node_id}' not found or is not a COMPONENT node (operation index ${i}).`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
        }
        resolvedSources.push(src);
      }

      const tMut = Date.now();
      const created = [];

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const parentNode = pre.resolvedNodes[i];
        const instance = resolvedSources[i].createInstance();
        parentNode.appendChild(instance);
        if (op.x != null) instance.x = op.x;
        if (op.y != null) instance.y = op.y;
        if (op.component_properties) {
          try { instance.setProperties(op.component_properties); } catch (_) { /* ignore unsupported props */ }
        }
        created.push({ nodeId: instance.id, name: instance.name, type: "INSTANCE" });
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Created ${created.length} instance(s).`, { appliedCount: created.length, created }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_UPDATE_GEOMETRY ────────────────────────────────────────────────
    if (type === "BATCH_UPDATE_GEOMETRY") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE}.`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, ops.map((op) => op.node_id));
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Instance internal child check (non-INSTANCE nodes)
      for (let i = 0; i < pre.resolvedNodes.length; i++) {
        const node = pre.resolvedNodes[i];
        if (node.type !== "INSTANCE") {
          const instanceErr = checkInstanceChildWrite(node, params.scopeNodeId);
          if (instanceErr) {
            return errorEnvelope(instanceErr, `Node '${node.name}' is inside an INSTANCE subtree. Direct writes to instance internal children are forbidden in safe mode.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
          }
        }
      }

      const tMut = Date.now();
      let appliedCount = 0;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const node = pre.resolvedNodes[i];
        if (op.x != null && "x" in node) node.x = op.x;
        if (op.y != null && "y" in node) node.y = op.y;
        if ((op.width != null || op.height != null) && "resize" in node) {
          node.resize(op.width != null ? op.width : node.width, op.height != null ? op.height : node.height);
        }
        if (op.rotation != null && "rotation" in node) node.rotation = op.rotation;
        appliedCount++;
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Updated geometry on ${appliedCount} node(s).`, { appliedCount }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_UPDATE_AUTO_LAYOUT ─────────────────────────────────────────────
    if (type === "BATCH_UPDATE_AUTO_LAYOUT") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE}.`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, ops.map((op) => op.node_id));
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Auto-layout only on FRAME nodes
      for (let i = 0; i < pre.resolvedNodes.length; i++) {
        if (pre.resolvedNodes[i].type !== "FRAME") {
          return errorEnvelope("INVALID_NODE_TYPE", `Node '${pre.resolvedNodes[i].name}' is ${pre.resolvedNodes[i].type} — auto-layout requires FRAME.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
        }
      }

      const tMut = Date.now();
      let appliedCount = 0;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const node = pre.resolvedNodes[i];
        if (op.layout_mode != null) node.layoutMode = op.layout_mode;
        if (op.primary_axis_align_items != null) node.primaryAxisAlignItems = op.primary_axis_align_items;
        if (op.counter_axis_align_items != null) node.counterAxisAlignItems = op.counter_axis_align_items;
        if (op.item_spacing != null) node.itemSpacing = op.item_spacing;
        if (op.padding != null) {
          node.paddingTop = op.padding.top;
          node.paddingRight = op.padding.right;
          node.paddingBottom = op.padding.bottom;
          node.paddingLeft = op.padding.left;
        }
        appliedCount++;
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Updated auto-layout on ${appliedCount} frame(s).`, { appliedCount }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_UPDATE_TEXT ────────────────────────────────────────────────────
    if (type === "BATCH_UPDATE_TEXT") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE}.`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, ops.map((op) => op.node_id));
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Must be TEXT + not instance internal child
      for (let i = 0; i < pre.resolvedNodes.length; i++) {
        const node = pre.resolvedNodes[i];
        if (node.type !== "TEXT") {
          return errorEnvelope("INVALID_NODE_TYPE", `Node '${node.name}' is ${node.type}, not TEXT.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
        }
        const instanceErr = checkInstanceChildWrite(node, params.scopeNodeId);
        if (instanceErr) {
          return errorEnvelope(instanceErr, `Node '${node.name}' is inside an INSTANCE subtree. Text inside instances cannot be directly written in safe mode.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
        }
      }

      const tMut = Date.now();
      let appliedCount = 0;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const node = pre.resolvedNodes[i];

        // Load fonts before modifying characters
        if (op.font_name) {
          await figma.loadFontAsync(op.font_name);
          node.fontName = op.font_name;
        } else if (node.fontName !== figma.mixed) {
          await figma.loadFontAsync(node.fontName);
        } else {
          const fonts = node.getRangeAllFontNames(0, node.characters.length);
          await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
        }

        if (op.font_size != null) node.fontSize = op.font_size;
        node.characters = op.characters;
        appliedCount++;
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Updated text on ${appliedCount} node(s).`, { appliedCount }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_UPDATE_FILLS_STROKES_EFFECTS ───────────────────────────────────
    if (type === "BATCH_UPDATE_FILLS_STROKES_EFFECTS") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE}.`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, ops.map((op) => op.node_id));
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Check instance internal child write policy
      for (let i = 0; i < pre.resolvedNodes.length; i++) {
        const node = pre.resolvedNodes[i];
        if (node.type !== "INSTANCE") {
          const instanceErr = checkInstanceChildWrite(node, params.scopeNodeId);
          if (instanceErr) {
            return errorEnvelope(instanceErr, `Node '${node.name}' is inside an INSTANCE subtree.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
          }
        }
      }

      const tMut = Date.now();
      let appliedCount = 0;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const node = pre.resolvedNodes[i];
        if (op.fills != null && "fills" in node) node.fills = op.fills;
        if (op.strokes != null && "strokes" in node) node.strokes = op.strokes;
        if (op.stroke_weight != null && "strokeWeight" in node) node.strokeWeight = op.stroke_weight;
        if (op.effects != null && "effects" in node) node.effects = op.effects;
        appliedCount++;
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Updated fills/strokes/effects on ${appliedCount} node(s).`, { appliedCount }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_BIND_VARIABLES ─────────────────────────────────────────────────
    if (type === "BATCH_BIND_VARIABLES") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE}.`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      if (!figma.variables) {
        return errorEnvelope("VARIABLES_API_NOT_AVAILABLE", "Figma Variables API is not available in this context.", {}, { totalMs: Date.now() - t0 });
      }

      const tPre = Date.now();
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, ops.map((op) => op.node_id));
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Pre-resolve all variables (all-or-nothing: fail before any mutation)
      const resolvedBindings = [];
      for (let i = 0; i < ops.length; i++) {
        const opBindings = [];
        for (const binding of ops[i].bindings) {
          if (binding.variable_id !== null && binding.variable_id !== undefined) {
            const variable = await figma.variables.getVariableByIdAsync(binding.variable_id);
            if (!variable) {
              return errorEnvelope("VARIABLE_NOT_FOUND", `Variable '${binding.variable_id}' not found (operation index ${i}).`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
            }
            opBindings.push({ property: binding.property, variable });
          } else {
            opBindings.push({ property: binding.property, variable: null });
          }
        }
        resolvedBindings.push(opBindings);
      }

      const tMut = Date.now();
      let appliedCount = 0;

      for (let i = 0; i < ops.length; i++) {
        const node = pre.resolvedNodes[i];
        for (const { property, variable } of resolvedBindings[i]) {
          node.setBoundVariable(property, variable);
        }
        appliedCount++;
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Bound variables on ${appliedCount} node(s).`, { appliedCount }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_UPDATE_COMPONENT_PROPERTIES ────────────────────────────────────
    if (type === "BATCH_UPDATE_COMPONENT_PROPERTIES") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE}.`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, ops.map((op) => op.node_id));
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Must be INSTANCE type
      for (let i = 0; i < pre.resolvedNodes.length; i++) {
        if (pre.resolvedNodes[i].type !== "INSTANCE") {
          return errorEnvelope("INVALID_NODE_TYPE", `Node '${pre.resolvedNodes[i].name}' is ${pre.resolvedNodes[i].type} — component property updates require INSTANCE.`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
        }
      }

      const tMut = Date.now();
      let appliedCount = 0;

      for (let i = 0; i < ops.length; i++) {
        pre.resolvedNodes[i].setProperties(ops[i].properties);
        appliedCount++;
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Updated component properties on ${appliedCount} instance(s).`, { appliedCount }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── BATCH_REORDER_MOVE ───────────────────────────────────────────────────
    if (type === "BATCH_REORDER_MOVE") {
      const ops = params.operations || [];
      if (ops.length === 0 || ops.length > MAX_BATCH_SIZE) {
        return errorEnvelope("BATCH_TOO_LARGE", `Operation count must be 1–${MAX_BATCH_SIZE}.`, {}, { totalMs: Date.now() - t0 }, "split_batch_into_smaller_chunks_and_retry");
      }

      const tPre = Date.now();
      const pre = await runPreflight(params.fileKey, params.scopeNodeId, ops.map((op) => op.node_id));
      if (!pre.ok) {
        return errorEnvelope(pre.error, pre.message, { failedOperationIndex: pre.failedOperationIndex }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
      }

      // Pre-validate all new parents before any mutation
      const resolvedNewParents = [];
      for (let i = 0; i < ops.length; i++) {
        if (ops[i].new_parent_node_id) {
          const np = await figma.getNodeByIdAsync(ops[i].new_parent_node_id);
          if (!np) {
            return errorEnvelope("NODE_NOT_FOUND", `New parent '${ops[i].new_parent_node_id}' not found (operation index ${i}).`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
          }
          if (!isNodeInScope(np, params.scopeNodeId)) {
            return errorEnvelope("OUT_OF_SCOPE_NODE", `New parent '${np.name}' is not inside scope (operation index ${i}).`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre });
          }
          const parentErr = validateParentType(np);
          if (parentErr) {
            return errorEnvelope(parentErr, `New parent '${np.name}' (${np.type}) is not an allowed parent type (operation index ${i}).`, { failedOperationIndex: i }, { totalMs: Date.now() - t0, preflightMs: Date.now() - tPre }, "remove_invalid_parent_and_retry");
          }
          resolvedNewParents.push(np);
        } else {
          resolvedNewParents.push(null);
        }
      }

      const tMut = Date.now();
      let appliedCount = 0;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const node = pre.resolvedNodes[i];
        const newParent = resolvedNewParents[i];

        if (newParent) {
          if (op.new_index != null) {
            const safeIdx = Math.min(op.new_index, newParent.children.length);
            newParent.insertChild(safeIdx, node);
          } else {
            newParent.appendChild(node);
          }
        } else if (op.new_index != null && node.parent && "insertChild" in node.parent) {
          const safeIdx = Math.min(op.new_index, node.parent.children.length - 1);
          node.parent.insertChild(safeIdx, node);
        }

        if (op.x != null && "x" in node) node.x = op.x;
        if (op.y != null && "y" in node) node.y = op.y;
        appliedCount++;
      }

      const tEnd = Date.now();
      return makeEnvelope("write_applied", "OK", `Reordered/moved ${appliedCount} node(s).`, { appliedCount }, { totalMs: tEnd - t0, preflightMs: tMut - tPre, mutationMs: tEnd - tMut });
    }

    // ── DESTRUCTIVE: DELETE_NODE — always blocked ────────────────────────────
    if (type === "DELETE_NODE") {
      return errorEnvelope(
        "DESTRUCTIVE_OPERATION_FORBIDDEN",
        "delete_node is not available in safe mode. Perform destructive actions manually in the Figma UI.",
        { appliedCount: 0 },
        { totalMs: Date.now() - t0 },
        "remove_destructive_operations_and_retry"
      );
    }

    // ── EXECUTE_JS — unsafe mode only ────────────────────────────────────────
    if (type === "EXECUTE_JS") {
      if (params.unsafeMode !== true) {
        return errorEnvelope(
          "DESTRUCTIVE_OPERATION_FORBIDDEN",
          "execute_js is not available in safe mode. Set UNSAFE_MODE=true on the MCP server to enable it.",
          { appliedCount: 0 },
          { totalMs: Date.now() - t0 },
          "remove_destructive_operations_and_retry"
        );
      }
      // Unsafe execution: params.code runs with figma injected
      const fn = new Function("figma", "return (async () => { " + params.code + " })()");
      const result = await fn(figma);
      return { success: true, result: result !== undefined && result !== null ? result : null };
    }

    throw new Error(`Unknown command: ${type}`);
  }

  try {
    const result = await run();
    figma.ui.postMessage({ id, result });
  } catch (err) {
    figma.ui.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
