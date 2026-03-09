import { randomUUID } from 'crypto';
import {
  WorkflowDefinition,
  ExecutionRecord,
  Step,
  StepResult,
  ErrorStrategy,
  VALID_TRANSITIONS,
  WorkflowStatus,
} from '../models/types';
import { evaluateCondition } from './condition-evaluator';
import { interpolate } from './interpolator';
import { createLogger } from '../utils/logger';

const logger = createLogger('workflow-engine');

// --- Types d'actions custom ---

type ActionHandler = (
  step: Step,
  context: Record<string, unknown>
) => Promise<unknown>;

// --- Moteur principal ---

export class WorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private actionHandlers: Map<string, ActionHandler> = new Map();
  private executionHistory: ExecutionRecord[] = [];

  constructor() {
    this.registerBuiltInActions();
  }

  // --- Enregistrement des workflows ---

  register(workflow: WorkflowDefinition): void {
    logger.info({ workflowId: workflow.id, name: workflow.name }, 'Workflow enregistré');
    this.workflows.set(workflow.id, workflow);
  }

  unregister(workflowId: string): void {
    this.workflows.delete(workflowId);
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  // --- Lifecycle ---

  changeStatus(workflowId: string, newStatus: WorkflowStatus): WorkflowDefinition {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" introuvable`);
    }

    const validTransitions = VALID_TRANSITIONS[workflow.status];
    if (!validTransitions.includes(newStatus)) {
      throw new Error(
        `Transition invalide : ${workflow.status} → ${newStatus}. Transitions valides : ${validTransitions.join(', ')}`
      );
    }

    workflow.status = newStatus;
    workflow.metadata.updatedAt = new Date().toISOString();
    logger.info({ workflowId, from: workflow.status, to: newStatus }, 'Statut du workflow modifié');

    return workflow;
  }

  // --- Exécution ---

  async execute(
    workflowId: string,
    triggerPayload: Record<string, unknown>,
    options: { isSandbox?: boolean; idempotencyKey?: string } = {}
  ): Promise<ExecutionRecord> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow "${workflowId}" introuvable`);
    }

    // Vérifier l'idempotence
    if (options.idempotencyKey) {
      const existing = this.executionHistory.find(
        (e) => e.idempotencyKey === options.idempotencyKey
      );
      if (existing) {
        logger.info({ idempotencyKey: options.idempotencyKey }, 'Exécution déjà traitée (idempotent)');
        return existing;
      }
    }

    const execution: ExecutionRecord = {
      id: randomUUID(),
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: 'RUNNING',
      trigger: { type: workflow.trigger.type, payload: triggerPayload },
      context: { ...triggerPayload },
      steps: [],
      idempotencyKey: options.idempotencyKey,
      isSandbox: options.isSandbox ?? false,
      startedAt: new Date().toISOString(),
    };

    const startTime = Date.now();

    logger.info(
      { executionId: execution.id, workflowId, workflowName: workflow.name },
      'Début de l\'exécution du workflow'
    );

    try {
      for (const step of workflow.steps) {
        const stepResult = await this.executeStep(step, execution.context, options.isSandbox);
        execution.steps.push(stepResult);

        // Enrichir le contexte avec le résultat du step
        if (stepResult.output !== undefined) {
          execution.context[`step_${step.id}`] = stepResult.output;
          execution.context[step.name] = stepResult.output;
        }

        // Si le step a échoué et la stratégie est "stop", arrêter
        if (stepResult.status === 'failed' && step.onError === 'stop') {
          execution.status = 'FAILED';
          execution.error = stepResult.error;
          break;
        }
      }

      if (execution.status !== 'FAILED') {
        execution.status = 'COMPLETED';
      }
    } catch (error) {
      execution.status = 'FAILED';
      execution.error = error instanceof Error ? error.message : String(error);
      logger.error({ executionId: execution.id, error: execution.error }, 'Erreur lors de l\'exécution');
    } finally {
      execution.completedAt = new Date().toISOString();
      execution.duration = Date.now() - startTime;
      this.executionHistory.push(execution);

      // Mettre à jour les stats du workflow
      workflow.metadata.executionCount++;
      workflow.metadata.lastExecutedAt = execution.startedAt;

      logger.info(
        {
          executionId: execution.id,
          status: execution.status,
          duration: execution.duration,
        },
        'Exécution terminée'
      );
    }

    return execution;
  }

  // --- Exécution d'un step ---

  private async executeStep(
    step: Step,
    context: Record<string, unknown>,
    isSandbox?: boolean
  ): Promise<StepResult> {
    const startTime = Date.now();

    // Vérifier la condition
    if (step.condition) {
      const conditionMet = evaluateCondition(step.condition, context);
      if (!conditionMet) {
        return {
          stepId: step.id,
          stepName: step.name,
          status: 'skipped',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          duration: 0,
        };
      }
    }

    // Exécuter avec retry si nécessaire
    let lastError: string | undefined;
    const maxAttempts = step.onError === 'retry' && step.retryConfig
      ? step.retryConfig.maxRetries + 1
      : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const delay = step.retryConfig!.backoffMs *
            Math.pow(step.retryConfig!.backoffMultiplier, attempt - 1);
          logger.debug({ stepId: step.id, attempt, delay }, 'Retry avec backoff');
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const handler = this.actionHandlers.get(step.type);
        if (!handler) {
          throw new Error(`Type d'action inconnu : ${step.type}`);
        }

        // Interpoler la config du step
        const interpolatedConfig = this.interpolateConfig(step.config, context);
        const stepWithInterpolatedConfig = { ...step, config: interpolatedConfig };

        // Mode sandbox : ne pas exécuter les actions de communication
        if (isSandbox && ['send_sms', 'send_email', 'send_whatsapp'].includes(step.type)) {
          logger.info({ stepId: step.id, type: step.type }, 'Action simulée (sandbox)');
          return {
            stepId: step.id,
            stepName: step.name,
            status: 'success',
            output: { sandbox: true, message: 'Action simulée en mode sandbox' },
            startedAt: new Date(startTime).toISOString(),
            completedAt: new Date().toISOString(),
            duration: Date.now() - startTime,
          };
        }

        const output = await handler(stepWithInterpolatedConfig, context);

        return {
          stepId: step.id,
          stepName: step.name,
          status: 'success',
          output,
          startedAt: new Date(startTime).toISOString(),
          completedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          retryCount: attempt > 0 ? attempt : undefined,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.warn(
          { stepId: step.id, attempt: attempt + 1, maxAttempts, error: lastError },
          'Erreur lors de l\'exécution du step'
        );
      }
    }

    // Toutes les tentatives échouées
    if (step.onError === 'skip') {
      return {
        stepId: step.id,
        stepName: step.name,
        status: 'skipped',
        error: lastError,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }

    return {
      stepId: step.id,
      stepName: step.name,
      status: 'failed',
      error: lastError,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
      retryCount: maxAttempts - 1,
    };
  }

  // --- Interpolation de la config ---

  private interpolateConfig(
    config: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        result[key] = interpolate(value, context);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  // --- Actions built-in ---

  private registerBuiltInActions(): void {
    // Log
    this.registerAction('log', async (step, context) => {
      const message = step.config.message as string || 'Log step';
      logger.info({ workflowLog: true, context }, message);
      return { logged: true, message };
    });

    // Delay
    this.registerAction('delay', async (step) => {
      const durationMs = (step.config.duration as number) || 1000;
      await new Promise((resolve) => setTimeout(resolve, durationMs));
      return { delayed: true, duration: durationMs };
    });

    // Enrich (ajoute des données au contexte)
    this.registerAction('enrich', async (step, context) => {
      const data = step.config.data as Record<string, unknown>;
      if (data) {
        Object.assign(context, data);
      }
      return { enriched: true, keys: data ? Object.keys(data) : [] };
    });

    // Transform
    this.registerAction('transform', async (step, context) => {
      const mappings = step.config.mappings as Record<string, string>;
      if (mappings) {
        const result: Record<string, unknown> = {};
        for (const [targetKey, sourcePath] of Object.entries(mappings)) {
          result[targetKey] = interpolate(`{{${sourcePath}}}`, context);
        }
        return result;
      }
      return {};
    });
  }

  // --- Enregistrement d'actions custom ---

  registerAction(type: string, handler: ActionHandler): void {
    this.actionHandlers.set(type, handler);
  }

  // --- Stats ---

  getStats(workflowId?: string): {
    total: number;
    completed: number;
    failed: number;
    avgDuration: number;
  } {
    const executions = workflowId
      ? this.executionHistory.filter((e) => e.workflowId === workflowId)
      : this.executionHistory;

    const completed = executions.filter((e) => e.status === 'COMPLETED');
    const failed = executions.filter((e) => e.status === 'FAILED');
    const durations = executions.filter((e) => e.duration).map((e) => e.duration!);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    return {
      total: executions.length,
      completed: completed.length,
      failed: failed.length,
      avgDuration: Math.round(avgDuration),
    };
  }

  getExecutionHistory(workflowId?: string): ExecutionRecord[] {
    if (workflowId) {
      return this.executionHistory.filter((e) => e.workflowId === workflowId);
    }
    return [...this.executionHistory];
  }
}
