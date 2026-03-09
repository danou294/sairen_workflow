import { Prisma, ExecutionStatus } from '@prisma/client';
import prisma from './prisma-client';
import { ExecutionRecord, StepResult } from '../models/types';
import { PaginationOptions, PaginatedResult } from '../models/pagination';
import { createLogger } from '../utils/logger';

const logger = createLogger('execution-repository');

export interface ExecutionFilters {
  workflowId?: string;
  status?: ExecutionStatus;
  startDate?: Date;
  endDate?: Date;
  isSandbox?: boolean;
}

export class ExecutionRepository {
  /** Crée un enregistrement d'exécution en DB (status: RUNNING) */
  async create(execution: ExecutionRecord): Promise<ExecutionRecord> {
    const record = await prisma.execution.create({
      data: {
        id: execution.id,
        workflowId: execution.workflowId,
        workflowVersion: execution.workflowVersion,
        status: execution.status as ExecutionStatus,
        trigger: execution.trigger as Prisma.InputJsonValue,
        context: execution.context as Prisma.InputJsonValue,
        steps: execution.steps as unknown as Prisma.InputJsonValue,
        idempotencyKey: execution.idempotencyKey,
        isSandbox: execution.isSandbox,
        error: execution.error,
        startedAt: new Date(execution.startedAt),
        completedAt: execution.completedAt ? new Date(execution.completedAt) : null,
        duration: execution.duration,
      },
    });

    logger.info({ executionId: record.id }, 'Exécution créée en DB');
    return this.toExecutionRecord(record);
  }

  /** Met à jour les steps d'une exécution en cours */
  async updateSteps(executionId: string, steps: StepResult[]): Promise<void> {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        steps: steps as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Finalise une exécution (status, completedAt, duration, error) */
  async complete(
    executionId: string,
    data: {
      status: ExecutionStatus;
      steps: StepResult[];
      context: Record<string, unknown>;
      error?: string;
      completedAt: string;
      duration: number;
    }
  ): Promise<ExecutionRecord> {
    const record = await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: data.status,
        steps: data.steps as unknown as Prisma.InputJsonValue,
        context: data.context as Prisma.InputJsonValue,
        error: data.error,
        completedAt: new Date(data.completedAt),
        duration: data.duration,
      },
    });

    logger.info(
      { executionId, status: data.status, duration: data.duration },
      'Exécution finalisée en DB'
    );
    return this.toExecutionRecord(record);
  }

  /** Trouve une exécution par ID */
  async findById(id: string): Promise<ExecutionRecord | null> {
    const record = await prisma.execution.findUnique({ where: { id } });
    return record ? this.toExecutionRecord(record) : null;
  }

  /** Trouve une exécution par clé d'idempotence */
  async findByIdempotencyKey(key: string): Promise<ExecutionRecord | null> {
    const record = await prisma.execution.findUnique({
      where: { idempotencyKey: key },
    });
    return record ? this.toExecutionRecord(record) : null;
  }

  /** Trouve les exécutions d'un workflow */
  async findByWorkflowId(workflowId: string): Promise<ExecutionRecord[]> {
    const records = await prisma.execution.findMany({
      where: { workflowId },
      orderBy: { startedAt: 'desc' },
    });
    return records.map((r) => this.toExecutionRecord(r));
  }

  /** Recherche avec pagination et filtres */
  async findWithPagination(
    filters: ExecutionFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<ExecutionRecord>> {
    const where: Prisma.ExecutionWhereInput = {};

    if (filters.workflowId) where.workflowId = filters.workflowId;
    if (filters.status) where.status = filters.status;
    if (filters.isSandbox !== undefined) where.isSandbox = filters.isSandbox;
    if (filters.startDate || filters.endDate) {
      where.startedAt = {};
      if (filters.startDate) where.startedAt.gte = filters.startDate;
      if (filters.endDate) where.startedAt.lte = filters.endDate;
    }

    const [data, total] = await Promise.all([
      prisma.execution.findMany({
        where,
        orderBy: { [pagination.sortBy || 'startedAt']: pagination.sortOrder || 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      prisma.execution.count({ where }),
    ]);

    return {
      data: data.map((r) => this.toExecutionRecord(r)),
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  /** Statistiques d'exécutions */
  async getStats(workflowId?: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    avgDuration: number;
  }> {
    const where: Prisma.ExecutionWhereInput = workflowId ? { workflowId } : {};

    const [total, completed, failed, avgResult] = await Promise.all([
      prisma.execution.count({ where }),
      prisma.execution.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.execution.count({ where: { ...where, status: 'FAILED' } }),
      prisma.execution.aggregate({
        where: { ...where, duration: { not: null } },
        _avg: { duration: true },
      }),
    ]);

    return {
      total,
      completed,
      failed,
      avgDuration: Math.round(avgResult._avg.duration || 0),
    };
  }

  /** Convertit un record Prisma en ExecutionRecord */
  private toExecutionRecord(record: {
    id: string;
    workflowId: string;
    workflowVersion: number;
    status: ExecutionStatus;
    trigger: Prisma.JsonValue;
    context: Prisma.JsonValue;
    steps: Prisma.JsonValue;
    idempotencyKey: string | null;
    isSandbox: boolean;
    error: string | null;
    startedAt: Date;
    completedAt: Date | null;
    duration: number | null;
  }): ExecutionRecord {
    return {
      id: record.id,
      workflowId: record.workflowId,
      workflowVersion: record.workflowVersion,
      status: record.status,
      trigger: record.trigger as ExecutionRecord['trigger'],
      context: record.context as Record<string, unknown>,
      steps: record.steps as unknown as StepResult[],
      idempotencyKey: record.idempotencyKey ?? undefined,
      isSandbox: record.isSandbox,
      error: record.error ?? undefined,
      startedAt: record.startedAt.toISOString(),
      completedAt: record.completedAt?.toISOString(),
      duration: record.duration ?? undefined,
    };
  }
}
