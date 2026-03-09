// === Types principaux du Workflow Engine ===

// --- Statuts ---

export type WorkflowStatus = 'DRAFT' | 'TESTING' | 'LIVE' | 'ARCHIVED';

export type ExecutionStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type ErrorStrategy = 'stop' | 'skip' | 'retry';

// --- Trigger ---

export type TriggerType =
  | 'rdv_created'
  | 'rdv_cancelled'
  | 'rdv_reminder'
  | 'patient_created'
  | 'invoice_overdue'
  | 'form_submitted'
  | 'manual'
  | 'webhook'
  | 'cron'
  | 'internal';

export interface Trigger {
  type: TriggerType;
  config: Record<string, unknown>;
  filters?: Condition[];
}

// --- Conditions ---

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'greater_than'
  | 'less_than'
  | 'exists'
  | 'not_exists'
  | 'in'
  | 'not_in'
  | 'matches'
  | 'date_before'
  | 'date_after';

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  logic?: 'AND' | 'OR';
}

// --- Actions ---

export type ActionType =
  | 'send_sms'
  | 'send_email'
  | 'send_whatsapp'
  | 'call_vocal_agent'
  | 'http_request'
  | 'delay'
  | 'enrich'
  | 'transform'
  | 'branch'
  | 'loop'
  | 'assign_task'
  | 'update_crm'
  | 'log';

// --- Step ---

export interface RetryConfig {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
}

export interface Step {
  id: string;
  name: string;
  type: ActionType;
  config: Record<string, unknown>;
  condition?: Condition;
  onError: ErrorStrategy;
  retryConfig?: RetryConfig;
  timeout?: number;
  next?: string;
}

// --- Step Result ---

export interface StepResult {
  stepId: string;
  stepName: string;
  status: 'success' | 'failed' | 'skipped';
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  retryCount?: number;
}

// --- Workflow ---

export interface Variable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object';
  defaultValue?: unknown;
  required: boolean;
  description?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  status: WorkflowStatus;
  trigger: Trigger;
  steps: Step[];
  variables: Variable[];
  tags: string[];
  metadata: {
    createdBy: string;
    organizationId: string;
    createdAt: string;
    updatedAt: string;
    lastExecutedAt?: string;
    executionCount: number;
  };
}

// --- Execution ---

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: ExecutionStatus;
  trigger: { type: string; payload: unknown };
  context: Record<string, unknown>;
  steps: StepResult[];
  idempotencyKey?: string;
  isSandbox: boolean;
  error?: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
}

// --- Channel ---

export interface ChannelMessage {
  to: string;
  subject?: string;
  body: string;
  templateId?: string;
  variables?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ChannelResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered';

// --- Events ---

export interface WorkflowEvent {
  id: string;
  type: TriggerType;
  payload: Record<string, unknown>;
  source: string;
  timestamp: string;
  organizationId: string;
  correlationId?: string;
}

// --- Transitions valides du lifecycle ---

export const VALID_TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  DRAFT: ['TESTING'],
  TESTING: ['LIVE', 'DRAFT'],
  LIVE: ['ARCHIVED', 'TESTING'],
  ARCHIVED: ['DRAFT'],
};
