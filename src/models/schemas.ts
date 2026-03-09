import { z } from 'zod';

// --- Opérateurs de condition ---

export const conditionOperators = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'exists',
  'not_exists',
  'in',
  'not_in',
  'matches',
  'date_before',
  'date_after',
] as const;

// --- Types d'action ---

export const actionTypes = [
  'send_sms',
  'send_email',
  'send_whatsapp',
  'call_vocal_agent',
  'http_request',
  'delay',
  'enrich',
  'transform',
  'branch',
  'loop',
  'assign_task',
  'update_crm',
  'log',
] as const;

// --- Types de trigger ---

export const triggerTypes = [
  'rdv_created',
  'rdv_cancelled',
  'rdv_reminder',
  'patient_created',
  'invoice_overdue',
  'form_submitted',
  'manual',
  'webhook',
  'cron',
  'internal',
] as const;

// --- Schemas ---

export const conditionSchema = z.object({
  field: z.string().min(1, 'Le champ de la condition est requis'),
  operator: z.enum(conditionOperators),
  value: z.unknown().optional(),
  logic: z.enum(['AND', 'OR']).optional(),
});

export const retryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(10),
  backoffMs: z.number().int().min(100).max(60000),
  backoffMultiplier: z.number().min(1).max(5),
});

export const stepSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, 'Le nom du step est requis'),
  type: z.string().min(1, 'Le type d\'action est requis'),
  config: z.record(z.unknown()),
  condition: conditionSchema.optional(),
  onError: z.enum(['stop', 'skip', 'retry']),
  retryConfig: retryConfigSchema.optional(),
  timeout: z.number().int().positive().optional(),
  next: z.string().uuid().optional(),
});

export const triggerSchema = z.object({
  type: z.enum(triggerTypes),
  config: z.record(z.unknown()),
  filters: z.array(conditionSchema).optional(),
});

export const variableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'date', 'object']),
  defaultValue: z.unknown().optional(),
  required: z.boolean(),
  description: z.string().optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Le nom du workflow est requis').max(200),
  description: z.string().max(2000).default(''),
  trigger: triggerSchema,
  steps: z.array(stepSchema).min(1, 'Au moins un step est requis'),
  variables: z.array(variableSchema).default([]),
  tags: z.array(z.string()).default([]),
});

export const updateWorkflowSchema = createWorkflowSchema.partial();

export const changeStatusSchema = z.object({
  status: z.enum(['DRAFT', 'TESTING', 'LIVE', 'ARCHIVED']),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const workflowFilterSchema = paginationSchema.extend({
  status: z.enum(['DRAFT', 'TESTING', 'LIVE', 'ARCHIVED']).optional(),
  tags: z.string().optional(), // Comma-separated
  search: z.string().optional(),
});

// --- Webhook ---

export const webhookPayloadSchema = z.object({
  type: z.enum(triggerTypes),
  payload: z.record(z.unknown()),
  correlationId: z.string().uuid().optional(),
  idempotencyKey: z.string().optional(),
});

// --- Manual trigger ---

export const manualTriggerSchema = z.object({
  payload: z.record(z.unknown()).default({}),
  isSandbox: z.boolean().default(false),
  idempotencyKey: z.string().optional(),
});

// Types inférés
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type WorkflowFilterInput = z.infer<typeof workflowFilterSchema>;
export type WebhookPayloadInput = z.infer<typeof webhookPayloadSchema>;
export type ManualTriggerInput = z.infer<typeof manualTriggerSchema>;
