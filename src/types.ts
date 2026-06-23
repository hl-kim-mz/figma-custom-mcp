// Shared types for figma-custom-mcp result envelopes and error codes

export type TimingMetrics = {
  totalMs: number;
  preflightMs?: number;
  mutationMs?: number;
  responseMs?: number;
  bridgeRoundTripMs?: number;
};

export type ToolResultStatus =
  | "write_applied"
  | "write_verified"
  | "needs_user_review"
  | "error";

export type ToolResult = {
  status: ToolResultStatus;
  code: string;
  message: string;
  details: Record<string, unknown>;
  timing: TimingMetrics;
  nextAction: string;
};

export const ERROR_CODES = {
  FILE_KEY_MISMATCH: "FILE_KEY_MISMATCH",
  INVALID_SCOPE_ROOT_TYPE: "INVALID_SCOPE_ROOT_TYPE",
  OUT_OF_SCOPE_NODE: "OUT_OF_SCOPE_NODE",
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
  INSTANCE_CHILD_WRITE_FORBIDDEN: "INSTANCE_CHILD_WRITE_FORBIDDEN",
  EXTERNAL_COMPONENT_WRITE_FORBIDDEN: "EXTERNAL_COMPONENT_WRITE_FORBIDDEN",
  DESTRUCTIVE_OPERATION_FORBIDDEN: "DESTRUCTIVE_OPERATION_FORBIDDEN",
  BATCH_TOO_LARGE: "BATCH_TOO_LARGE",
  PREFLIGHT_TIMEOUT: "PREFLIGHT_TIMEOUT",
  MUTATION_TIMEOUT_PARTIAL_UNKNOWN: "MUTATION_TIMEOUT_PARTIAL_UNKNOWN",
  RESPONSE_TIMEOUT_STATE_UNKNOWN: "RESPONSE_TIMEOUT_STATE_UNKNOWN",
  INVALID_PARENT_NODE: "INVALID_PARENT_NODE",
  INVALID_CREATE_TYPE: "INVALID_CREATE_TYPE",
  SOURCE_COMPONENT_NOT_ACCESSIBLE: "SOURCE_COMPONENT_NOT_ACCESSIBLE",
  MAX_DEPTH_TOO_LARGE: "MAX_DEPTH_TOO_LARGE",
  VARIABLE_NOT_FOUND: "VARIABLE_NOT_FOUND",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
