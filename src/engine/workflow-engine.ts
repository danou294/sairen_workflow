import { randomUUID } from 'crypto';
import {
  WorkflowDefinition,
  ExecutionRecord,
  Step,
  StepResult,
  VALID_TRANSITIONS,
  WorkflowStatus,
} from '../models/types';
import { evaluateCondition } from './condition-evaluator';
import { interpolate } from './interpolator';
import { WorkflowValidator } from './workflow-validator';
import { WorkflowRepository } from './workflow-repository';
import { ExecutionRepository } from './execution-repository';
import {
  WorkflowNotFoundError,
  InvalidTransitionError,
  ValidationError,
  ExecutionNotAllowedError,
  UnknownActionError,
  PersistenceError,
} from '../errors/workflow-errors';
import { createLogger } from '../utils/logger';

const logger = createLogger('workflow-engine');

// --- Types d'actions custom ---

type ActionHandler = (
  step: Step,
  context: Record<string, unknown>
) => Promise<unknown>;

// --- Options du moteur ---

export interface EngineOptions {
  /** Utiliser Prisma pour la persistance (false = in-memory pour les tests) */
  persistent?: boolean;
  /** Taille max de l'historique en mémoire (protection memory leak) */
  maxHistorySize?: number;
}

// --- Moteur principal ---

export class WorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private actionHandlers: Map<string, ActionHandler> = new Map();
  private executionHistory: ExecutionRecord[] = [];
  private readonly maxHistorySize: number;
  private validator: WorkflowValidator;
  private workflowRepo?: WorkflowRepository;
  private executionRepo?: ExecutionRepository;
  private persistent: boolean;

  constructor(options: EngineOptions = {}) {
    this.persistent = options.persistent ?? false;
    this.maxHistorySize = options.maxHistorySize ?? 1000;
    this.validator = new WorkflowValidator();

    if (this.persistent) {
      this.workflowRepo = new WorkflowRepository();
      this.executionRepo = new ExecutionRepository();
    }

    this.registerBuiltInActions();
  }

  // --- Enregistrement des workflows ---

  register(workflow: WorkflowDefinition): void {
    logger.info({ workflowId: workflow.id, name: workflow.name }, 'Workflow enregistré');
    this.workflows.set(workflow.id, workflow);
  }

  /** Enregistre avec validation préalable */
  registerWithValidation(workflow: WorkflowDefinition): { success: boolean; errors?: { field: string; message: string }[] } {
    const validation = this.validator.validate(workflow);
    if (!validation.valid) {
      logger.warn({ workflowId: workflow.id, errors: validation.errors }, 'Validation échouée');
      return { success: false, errors: validation.errors };
    }
    this.register(workflow);
    return { success: true };
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

  /** Charge un workflow depuis la DB et le met en cache mémoire */
  async loadFromDB(workflowId: string): Promise<WorkflowDefinition | null> {
    if (!this.workflowRepo) {
      throw new PersistenceError();
    }

    const workflow = await this.workflowRepo.findById(workflowId);
    if (workflow) {
      this.workflows.set(workflow.id, workflow);
      logger.info({ workflowId, name: workflow.name }, 'Workflow chargé depuis la DB');
    }
    return workflow;
  }

  /** Charge tous les workflows LIVE et TESTING depuis la DB */
  async loadActiveWorkflows(organizationId?: string): Promise<number> {
    if (!this.workflowRepo) {
      throw new PersistenceError();
    }

    let loaded = 0;

    for (const status of ['LIVE', 'TESTING'] as WorkflowStatus[]) {
      // Si pas d'organizationId, on charge pour toutes les orgas via une requête directe
      const result = await this.workflowRepo.findByStatus(status, organizationId);

      for (const wf of result) {
        this.workflows.set(wf.id, wf);
        loaded++;
      }
    }

    logger.info({ count: loaded, organizationId: organizationId ?? 'all' }, 'Workflows actifs chargés depuis la DB');
    return loaded;
  }

  // --- Lifecycle ---

  changeStatus(workflowId: string, newStatus: WorkflowStatus): WorkflowDefinition {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowNotFoundError(workflowId);
    }

    // Valider la transition
    const validTargets = VALID_TRANSITIONS[workflow.status];
    if (!validTargets.includes(newStatus)) {
      throw new InvalidTransitionError(workflow.status, newStatus, validTargets);
    }

    // Validations supplémentaires selon la cible
    if (newStatus === 'TESTING') {
      const testResult = this.validator.validateForTesting(workflow);
      if (!testResult.valid) {
        throw new ValidationError(
          `Impossible de passer en TESTING`,
          testResult.errors
        );
      }
    }

    if (newStatus === 'LIVE') {
      const liveResult = this.validator.validateForLive(workflow);
      if (!liveResult.valid) {
        throw new ValidationError(
          `Impossible de passer en LIVE`,
          liveResult.errors
        );
      }
    }

    const previousStatus = workflow.status;

    // Cloner pour éviter la mutation directe
    const updated: WorkflowDefinition = {
      ...workflow,
      status: newStatus,
      metadata: { ...workflow.metadata, updatedAt: new Date().toISOString() },
    };
    this.workflows.set(workflowId, updated);

    logger.info(
      { workflowId, from: previousStatus, to: newStatus },
      'Statut du workflow modifié'
    );

    return updated;
  }

  /** Change le statut avec persistance DB */
  async changeStatusPersistent(workflowId: string, newStatus: WorkflowStatus): Promise<WorkflowDefinition> {
    const workflow = this.changeStatus(workflowId, newStatus);

    if (this.workflowRepo) {
      await this.workflowRepo.changeStatus(workflowId, newStatus as 'DRAFT' | 'TESTING' | 'LIVE' | 'ARCHIVED');
    }

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
      throw new WorkflowNotFoundError(workflowId);
    }

    // Protéger l'exécution par statut
    if (workflow.status === 'DRAFT' || workflow.status === 'ARCHIVED') {
      throw new ExecutionNotAllowedError(workflowId, workflow.status);
    }
    if (workflow.status === 'TESTING' && !options.isSandbox) {
      throw new ExecutionNotAllowedError(
        workflowId,
        'TESTING (mode sandbox requis)'
      );
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

      if (this.executionRepo) {
        const dbExisting = await this.executionRepo.findByIdempotencyKey(options.idempotencyKey);
        if (dbExisting) {
          logger.info({ idempotencyKey: options.idempotencyKey }, 'Exécution déjà traitée (idempotent, DB)');
          return dbExisting;
        }
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

    // Persister l'exécution en DB (status: RUNNING)
    if (this.executionRepo) {
      await this.executionRepo.create(execution);
    }

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

        // Persister les steps après chaque step
        if (this.executionRepo) {
          await this.executionRepo.updateSteps(execution.id, execution.steps);
        }

        // Si le step a échoué et la stratégie est "stop" ou "retry" (retries épuisés), arrêter
        if (stepResult.status === 'failed' && (step.onError === 'stop' || step.onError === 'retry')) {
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

      // Historique circulaire (protection memory leak)
      this.executionHistory.push(execution);
      if (this.executionHistory.length > this.maxHistorySize) {
        this.executionHistory.shift();
      }

      // Finaliser en DB
      if (this.executionRepo) {
        await this.executionRepo.complete(execution.id, {
          status: execution.status as 'COMPLETED' | 'FAILED',
          steps: execution.steps,
          context: execution.context,
          error: execution.error,
          completedAt: execution.completedAt,
          duration: execution.duration,
        });
      }

      // Mettre à jour les stats du workflow (clone pour éviter mutation)
      const updatedWorkflow = {
        ...workflow,
        metadata: {
          ...workflow.metadata,
          executionCount: workflow.metadata.executionCount + 1,
          lastExecutedAt: execution.startedAt,
        },
      };
      this.workflows.set(workflowId, updatedWorkflow);

      if (this.workflowRepo) {
        await this.workflowRepo.incrementExecutionCount(workflowId);
      }

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

    // Mode sandbox : simuler les actions de communication sans les exécuter
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
          throw new UnknownActionError(step.type);
        }

        // Interpoler la config du step (récursif pour objets imbriqués)
        const interpolatedConfig = this.interpolateConfig(step.config, context);
        const stepWithInterpolatedConfig = { ...step, config: interpolatedConfig };

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

  // --- Interpolation récursive de la config ---

  private interpolateConfig(
    config: Record<string, unknown>,
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        result[key] = interpolate(value, context);
      } else if (Array.isArray(value)) {
        result[key] = value.map((v) =>
          typeof v === 'string' ? interpolate(v, context) : v
        );
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this.interpolateConfig(
          value as Record<string, unknown>,
          context
        );
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

  /** Stats depuis la DB */
  async getStatsPersistent(workflowId?: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    avgDuration: number;
  }> {
    if (!this.executionRepo) {
      return this.getStats(workflowId);
    }
    return this.executionRepo.getStats(workflowId);
  }

  getExecutionHistory(workflowId?: string): ExecutionRecord[] {
    if (workflowId) {
      return this.executionHistory.filter((e) => e.workflowId === workflowId);
    }
    return [...this.executionHistory];
  }

  /** Historique depuis la DB */
  async getExecutionHistoryPersistent(workflowId?: string): Promise<ExecutionRecord[]> {
    if (!this.executionRepo) {
      return this.getExecutionHistory(workflowId);
    }
    if (workflowId) {
      return this.executionRepo.findByWorkflowId(workflowId);
    }
    const result = await this.executionRepo.findWithPagination({}, { page: 1, limit: 100 });
    return result.data;
  }

  /** Accès au validateur */
  getValidator(): WorkflowValidator {
    return this.validator;
  }
}
