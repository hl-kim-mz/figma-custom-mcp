// MCP Bridge Plugin — main thread (plugin sandbox)
// All Plugin API calls happen here; WebSocket lives in ui.html.

figma.showUI(__html__, { width: 300, height: 180, title: "MCP Bridge" });

figma.ui.onmessage = async (msg) => {
  const { id, type, params } = msg;

  async function run() {
    switch (type) {
      case "UPDATE_TEXT": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        if (node.type !== "TEXT") throw new Error(`Node ${params.nodeId} is not a TEXT node (got ${node.type})`);
        await figma.loadFontAsync(node.fontName);
        node.characters = params.text;
        return { success: true, nodeId: params.nodeId };
      }

      case "SET_FILL": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        if (!("fills" in node)) throw new Error(`Node ${params.nodeId} does not support fills`);

        const hex = params.hexColor.replace(/^#/, "");
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const g = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const opacity = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;

        node.fills = [{ type: "SOLID", color: { r, g, b }, opacity }];
        return { success: true, nodeId: params.nodeId, color: params.hexColor };
      }

      case "CREATE_FRAME": {
        const frame = figma.createFrame();
        frame.name = params.name;
        frame.resize(params.width, params.height);
        frame.x = params.x != null ? params.x : 0;
        frame.y = params.y != null ? params.y : 0;
        figma.currentPage.appendChild(frame);
        return { success: true, nodeId: frame.id, name: frame.name };
      }

      case "RENAME_NODE": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        node.name = params.name;
        return { success: true, nodeId: params.nodeId, name: params.name };
      }

      case "MOVE_NODE": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        if (!("x" in node)) throw new Error(`Node ${params.nodeId} does not support positioning`);
        node.x = params.x;
        node.y = params.y;
        return { success: true, nodeId: params.nodeId, x: params.x, y: params.y };
      }

      case "RESIZE_NODE": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        if (!("resize" in node)) throw new Error(`Node ${params.nodeId} does not support resizing`);
        node.resize(params.width, params.height);
        return { success: true, nodeId: params.nodeId, width: params.width, height: params.height };
      }

      case "DELETE_NODE": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        node.remove();
        return { success: true, nodeId: params.nodeId };
      }

      case "CLONE_NODE": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        const clone = node.clone();
        if (params.parentId) {
          const parent = await figma.getNodeByIdAsync(params.parentId);
          if (!parent) throw new Error(`Parent not found: ${params.parentId}`);
          if (!("appendChild" in parent)) throw new Error(`Parent does not support appendChild`);
          parent.appendChild(clone);
        } else {
          figma.currentPage.appendChild(clone);
        }
        if (params.x != null) clone.x = params.x;
        if (params.y != null) clone.y = params.y;
        return { success: true, nodeId: clone.id, name: clone.name, type: clone.type };
      }

      case "CREATE_INSTANCE": {
        const component = await figma.getNodeByIdAsync(params.componentId);
        if (!component) throw new Error(`Component not found: ${params.componentId}`);
        if (component.type !== "COMPONENT") throw new Error(`Node ${params.componentId} is not a COMPONENT (got ${component.type})`);
        const instance = component.createInstance();
        if (params.parentId) {
          const parent = await figma.getNodeByIdAsync(params.parentId);
          if (!parent) throw new Error(`Parent not found: ${params.parentId}`);
          if (!("appendChild" in parent)) throw new Error(`Parent does not support appendChild`);
          parent.appendChild(instance);
        } else {
          figma.currentPage.appendChild(instance);
        }
        if (params.x != null) instance.x = params.x;
        if (params.y != null) instance.y = params.y;
        return { success: true, nodeId: instance.id, name: instance.name };
      }

      case "APPEND_CHILD": {
        const node = await figma.getNodeByIdAsync(params.nodeId);
        const parent = await figma.getNodeByIdAsync(params.parentId);
        if (!node) throw new Error(`Node not found: ${params.nodeId}`);
        if (!parent) throw new Error(`Parent not found: ${params.parentId}`);
        if (!("appendChild" in parent)) throw new Error(`Parent does not support appendChild`);
        parent.appendChild(node);
        if (params.x != null) node.x = params.x;
        if (params.y != null) node.y = params.y;
        return { success: true, nodeId: node.id, parentId: parent.id };
      }

      case "EXECUTE_JS": {
        const fn = new Function('figma', 'return (async () => { ' + params.code + ' })()');
        const result = await fn(figma);
        return { success: true, result: result !== undefined && result !== null ? result : null };
      }

      case "BATCH_CLONE": {
        const template = await figma.getNodeByIdAsync(params.nodeId);
        if (!template) throw new Error(`Node not found: ${params.nodeId}`);

        let parent;
        if (params.parentId) {
          parent = await figma.getNodeByIdAsync(params.parentId);
          if (!parent) throw new Error(`Parent not found: ${params.parentId}`);
          if (!("appendChild" in parent)) throw new Error(`Parent does not support appendChild`);
        } else {
          parent = figma.currentPage;
        }

        const count = params.count ?? 1;
        const gap = params.gap ?? 16;
        const offsetX = params.offsetX ?? 0;
        const offsetY = params.offsetY ?? (template.height + gap);
        const baseX = params.startX ?? template.x;
        const baseY = params.startY ?? (template.y + offsetY);

        const nodes = [];
        for (let i = 0; i < count; i++) {
          const clone = template.clone();
          parent.appendChild(clone);
          clone.x = baseX + i * offsetX;
          clone.y = baseY + i * offsetY;
          nodes.push({ nodeId: clone.id, name: clone.name, x: clone.x, y: clone.y });
        }
        return { success: true, created: count, nodes };
      }

      case "GET_NODE_TREE": {
        const maxDepth = params.depth ?? 3;

        function summarize(node, depth) {
          const out = { id: node.id, name: node.name, type: node.type };
          if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
            out.bounds = node.absoluteBoundingBox;
          }
          if (depth < maxDepth && "children" in node && node.children.length > 0) {
            out.children = node.children.map(c => summarize(c, depth + 1));
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
          children: page.children.map(c => summarize(c, 1)),
        };
      }

      default:
        throw new Error(`Unknown command: ${type}`);
    }
  }

  try {
    const result = await run();
    figma.ui.postMessage({ id, result });
  } catch (err) {
    figma.ui.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
