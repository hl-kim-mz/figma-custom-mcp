# figma-custom-mcp grilling decisions

Date: 2026-06-22

This document records the product/API decisions from the `grill-me` session so an implementation agent can work from a stable brief.

## Goal

Build a distributable Figma MCP server where a local coding agent talks to a Figma Desktop development plugin bridge.

Primary direction:
- Default public tools are fast, safe, dedicated batch primitives.
- `execute_js` is isolated behind unsafe advanced/developer mode.
- Verification of design intent is handled by the agent workflow, not by primitive write tools.

## Scope and safety

- Every write command requires `file_key` and target scope data.
- The plugin must verify the currently open Figma file matches `file_key` before mutation.
- Default work scope is the subtree under a user-provided Figma frame/section link.
- Scope root is limited to `FRAME | SECTION`.
- Scope membership is based on the real Figma layer tree, not visual overlap.
- A node that visually overlaps a frame but is not nested under it in the Layers panel is out of scope.
- If a batch includes any out-of-scope target node, reject the entire command.

Parent/child policy:
- `parent_node_id` means the real Figma node tree parent.
- Do not infer parent by coordinates or visual containment.
- Child creation is allowed only when the target has append/children capability and passes safe policy.
- Allowed parents:
  - `FRAME`
  - `SECTION`
  - local editable `COMPONENT`
  - local editable `COMPONENT_SET`
- Forbidden parents:
  - `TEXT`
  - shape nodes
  - `INSTANCE`
  - instance internal child nodes
  - external/library components
  - `GROUP`
- Parent/scope errors must explain "Layers panel nesting, not visual overlap".

## Editable area model

MVP editable areas:
- Scope subtree internal local nodes can be created/updated when the property is supported.
- Scope internal local `COMPONENT` and `COMPONENT_SET` can be directly created and modified.
- Text children inside local component sources can be directly modified.
- External/library component definitions cannot be directly modified.
- `INSTANCE` node geometry/layout can be modified.
- `INSTANCE` exposed component properties can be modified.
- Direct writes to internal child nodes of an `INSTANCE` are forbidden in safe mode.
- Detach/update/publish flows are excluded from MVP.

Component classification:
- A `COMPONENT` or `COMPONENT_SET` inside scope with `remote !== true` is a local editable component.
- An ambiguous component is treated as external/library and direct modification is forbidden.
- `INSTANCE` targets do not imply source component modification.
- Instance child direct writes return `INSTANCE_CHILD_WRITE_FORBIDDEN`.

MCP-created component metadata:
- Namespace: `figma-custom-mcp`
- `managed: "true"`
- `createdBy: "figma-custom-mcp"`
- `schemaVersion: "1"`

Use this metadata for future automatic modification/refactor/delete policy. Human-created local components inside scope are editable, but destructive actions remain conservative.

## Batch semantics

- MVP does not support `best_effort`.
- Batch calls are all-or-nothing per call.
- Invalid batch means zero mutations.
- Runtime failure during mutation must explicitly report partial-state uncertainty.
- All-or-nothing is guaranteed only per batch call, not across multiple calls.
- Larger workflows must be split by the agent into multiple calls.

Preflight validation order is fixed and fail-fast:
1. `file_key` verification
2. `scope_node_id` existence and `FRAME | SECTION` root validation
3. all target `node_id` existence validation
4. all targets are inside scope subtree
5. operation schema/type validation
6. node-type property applicability validation
7. batch size/timeout validation
8. mutation execution

Batch limits:
- Maximum operations per safe batch call: `100`
- Calls with 101+ operations fail in preflight with zero mutations.
- Timeout is `5000ms` total wall time per call.
- Timeout includes preflight, mutation, and response envelope creation.
- Timeout is per call, not per operation.
- MVP plugin does not run long-lived queued jobs.
- Agent should reduce chunk size based on timing metrics when timeout risk appears.

Timeout codes:
- `PREFLIGHT_TIMEOUT`
  - `appliedCount: 0`
  - `nextAction: "split_batch_into_smaller_chunks_and_retry"`
- `MUTATION_TIMEOUT_PARTIAL_UNKNOWN`
  - `appliedCount: null`
  - `nextAction: "refresh_state_before_retry"`
- `RESPONSE_TIMEOUT_STATE_UNKNOWN`
  - `appliedCount: null`
  - `nextAction: "refresh_state_before_retry"`

## Result envelope

All tool results use this top-level envelope:

```ts
{
  status: "write_applied" | "write_verified" | "needs_user_review" | "error",
  code: string,
  message: string,
  details: Record<string, unknown>,
  timing: TimingMetrics,
  nextAction: string
}
```

Timing metrics are always required:

```ts
type TimingMetrics = {
  totalMs: number
  preflightMs?: number
  mutationMs?: number
  analysisMs?: number
  responseMs?: number
  bridgeRoundTripMs?: number
}
```

Primitive write tool status policy:
- Successful safe mutation always returns `status: "write_applied"`.
- Normal success uses `code: "OK"`.
- Success with manual review candidates uses `code: "OK_WITH_REVIEW_CANDIDATES"`.
- Primitive write tools do not return `write_verified`.
- `write_verified` is reserved for agent-level workflow results after separate readback, screenshot, or inspection verification.
- MVP does not require implicit persistence of verification status.

## Destructive operations

Safe mode excludes destructive execution:
- delete node
- detach instance
- replace component source or replace node structure
- flatten/vector destructive operations
- boolean destructive operations
- library publish/update
- arbitrary `execute_js`
- generic JSON patch/operation DSL

Safe mode handling:
- Direct destructive execution request returns `status: "error"` and `code: "DESTRUCTIVE_OPERATION_FORBIDDEN"`.
- If a batch contains any destructive operation, reject the entire batch in preflight.
- `details.appliedCount` must be `0`.
- Include `failedOperationIndex` when applicable.
- `nextAction: "remove_destructive_operations_and_retry"`.

Read-only destructive analysis is allowed:
- Candidate lists and reasons may be returned.
- Actual destructive action is performed manually by the user in Figma UI.
- Explicit candidate analysis returns `status: "needs_user_review"` and candidate details.
- Safe write can still apply if destructive candidates are only follow-up review items.
- In that case, return `status: "write_applied"`, `code: "OK_WITH_REVIEW_CANDIDATES"`, and `details.reviewCandidates`.

## MVP safe tools

Dedicated safe batch tools:
1. `batch_create_nodes`
2. `batch_create_instances`
3. `batch_update_geometry`
4. `batch_update_auto_layout`
5. `batch_update_text`
6. `batch_update_fills_strokes_effects`
7. `batch_bind_variables`
8. `batch_update_component_properties`
9. `batch_reorder_move`

Dedicated read-only helper:
1. `inspect_scope_tree`

Excluded from MVP safe batch tools:
- delete/detach/replace
- arbitrary JS
- generic JSON patch DSL
- library publish/update

## `batch_create_nodes`

Creation is frame-centric. Allowed create types:

```ts
"FRAME" | "TEXT" | "RECTANGLE" | "ELLIPSE" | "LINE" | "COMPONENT" | "COMPONENT_SET"
```

Excluded create types:
- `GROUP`
- `INSTANCE`
- raw `VECTOR`
- `BOOLEAN_OPERATION`
- `SLICE`
- `CONNECTOR`
- widget/embed types

Existing `GROUP` nodes:
- May be limited update targets for geometry/move/reorder.
- Cannot receive auto-layout.
- Cannot be created by MVP tools.
- Cannot be a parent for new child nodes.

## `batch_create_instances`

`INSTANCE` creation is a separate safe tool, not part of `batch_create_nodes`.

MVP source policy:
- Accept source by `source_component_node_id`.
- Allow scope internal local components.
- Allow already imported accessible components.
- Do not perform library search/import in MVP.
- Parent must be inside scope and satisfy parent policy.
- Initial `componentProperties` may be set.
- Applies the same all-or-nothing, 100 operation, 5000ms timeout rules.

Future extensibility:
- Design internal abstractions around a `ComponentSourceRef` concept.
- Later versions may support exact component identity:

```ts
type ComponentSourceRef =
  | { kind: "node_id"; source_component_node_id: string }
  | {
      kind: "component_identity"
      library_key: string
      component_key: string
      full_name: string
      variant?: Record<string, string>
    }
```

Future resolve/import flow:
1. `resolve_component_source`
2. `import_component_source`
3. `batch_create_instances`

Name-based ambiguous search/import is not hidden inside `batch_create_instances`.

## `inspect_scope_tree`

Include as MVP read-only helper.

Purpose:
- Show scope root information.
- Return descendant count.
- Return allowed parent candidates.
- Mark instance boundaries.
- Mark local editable components.
- Mark external/library component markers.
- Help resolve `OUT_OF_SCOPE_NODE` and `INVALID_PARENT_NODE`.
- Always include timing metrics.

Input shape:

```ts
inspect_scope_tree({
  file_key: string,
  scope_node_id: string,
  include_allowed_parents?: boolean,
  max_depth?: number
})
```

Depth policy:
- Default `max_depth: 3`
- Maximum allowed `max_depth: 10`
- Too-large depth returns `MAX_DEPTH_TOO_LARGE`.

## Important error codes from this session

- `FILE_KEY_MISMATCH`
- `INVALID_SCOPE_ROOT_TYPE`
- `OUT_OF_SCOPE_NODE`
- `INSTANCE_CHILD_WRITE_FORBIDDEN`
- `EXTERNAL_COMPONENT_WRITE_FORBIDDEN`
- `DESTRUCTIVE_OPERATION_FORBIDDEN`
- `BATCH_TOO_LARGE`
- `PREFLIGHT_TIMEOUT`
- `MUTATION_TIMEOUT_PARTIAL_UNKNOWN`
- `RESPONSE_TIMEOUT_STATE_UNKNOWN`
- `INVALID_PARENT_NODE`
- `SOURCE_COMPONENT_NOT_ACCESSIBLE`
- `MAX_DEPTH_TOO_LARGE`

## Next open question

Question 42 should continue from:

How detailed should `inspect_scope_tree` output be by default, especially for large scopes? Decide which fields are returned at default depth 3 versus only when requested.
