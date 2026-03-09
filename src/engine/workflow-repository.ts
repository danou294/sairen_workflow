import { Prisma, WorkflowStatus } from '@prisma/client';
import prisma from './prisma-client';
import { WorkflowDefinition, Step, Trigger, Variable } from '../models/types';
import { PaginationOptions, PaginatedResult } from '../models/pagination';
import { createLogger } from '../utils/logger';

const logger = createLogger('workflow-repository');

export interface WorkflowFilters {
  organizationId: string;
  status?: WorkflowStatus;
  tags?: string[];
  search?: string;
}

export class WorkflowRepository {
  /** Crée un nouveau workflow en DB */
  async create(
    workflow: WorkflowDefinition,
    organizationId: string,
    createdById: string
  ): Promise<WorkflowDefinition> {
    const record = await prisma.workflow.create({
      data: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        version: 1,
        status: workflow.status as WorkflowStatus,
        trigger: workflow.trigger as unknown as Prisma.InputJsonValue,
        steps: workflow.steps as unknown as Prisma.InputJsonValue,
        variables: workflow.variables as unknown as Prisma.InputJsonValue,
        tags: workflow.tags,
        organizationId,
        createdById,
      },
    });

    // Créer la première version
    await this.createVersion(record.id, 1, record);

    logger.info({ workflowId: record.id, name: record.name }, 'Workflow créé en DB');
    return this.toWorkflowDefinition(record);
  }

  /** Met à jour un workflow et incrémente la version */
  async update(
    id: string,
    data: Partial<Pick<WorkflowDefinition, 'name' | 'description' | 'trigger' | 'steps' | 'variables' | 'tags'>>
  ): Promise<WorkflowDefinition> {
    // Récupérer la version actuelle
    const current = await prisma.workflow.findUnique({ where: { id } });
    if (!current) throw new Error(`Workflow "${id}" introuvable`);

    const newVersion = current.version + 1;

    const record = await prisma.workflow.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.trigger !== undefined && { trigger: data.trigger as unknown as Prisma.InputJsonValue }),
        ...(data.steps !== undefined && { steps: data.steps as unknown as Prisma.InputJsonValue }),
        ...(data.variables !== undefined && { variables: data.variables as unknown as Prisma.InputJsonValue }),
        ...(data.tags !== undefined && { tags: data.tags }),
        version: newVersion,
      },
    });

    // Sauvegarder le snapshot de cette version
    await this.createVersion(id, newVersion, record);

    logger.info({ workflowId: id, version: newVersion }, 'Workflow mis à jour (nouvelle version)');
    return this.toWorkflowDefinition(record);
  }

  /** Change le statut d'un workflow */
  async changeStatus(id: string, status: WorkflowStatus): Promise<WorkflowDefinition> {
    const record = await prisma.workflow.update({
      where: { id },
      data: { status },
    });

    logger.info({ workflowId: id, status }, 'Statut du workflow modifié');
    return this.toWorkflowDefinition(record);
  }

  /** Trouve un workflow par ID */
  async findById(id: string): Promise<WorkflowDefinition | null> {
    const record = await prisma.workflow.findUnique({ where: { id } });
    return record ? this.toWorkflowDefinition(record) : null;
  }

  /** Recherche avec pagination et filtres */
  async findWithPagination(
    filters: WorkflowFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<WorkflowDefinition>> {
    const where: Prisma.WorkflowWhereInput = {
      organizationId: filters.organizationId,
    };

    if (filters.status) where.status = filters.status;
    if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.workflow.findMany({
        where,
        orderBy: { [pagination.sortBy || 'createdAt']: pagination.sortOrder || 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      prisma.workflow.count({ where }),
    ]);

    return {
      data: data.map((r) => this.toWorkflowDefinition(r)),
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    };
  }

  /** Trouve les workflows par statut (optionnellement filtrés par orga) */
  async findByStatus(
    status: WorkflowStatus,
    organizationId?: string
  ): Promise<WorkflowDefinition[]> {
    const where: Prisma.WorkflowWhereInput = { status };
    if (organizationId) {
      where.organizationId = organizationId;
    }

    const records = await prisma.workflow.findMany({ where });
    return records.map((r) => this.toWorkflowDefinition(r));
  }

  /** Incrémente le compteur d'exécutions */
  async incrementExecutionCount(id: string): Promise<void> {
    await prisma.workflow.update({
      where: { id },
      data: {
        executionCount: { increment: 1 },
        lastExecutedAt: new Date(),
      },
    });
  }

  /** Soft delete (passage en ARCHIVED) */
  async archive(id: string): Promise<void> {
    await prisma.workflow.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    logger.info({ workflowId: id }, 'Workflow archivé');
  }

  /** Récupère l'historique des versions */
  async getVersionHistory(workflowId: string): Promise<
    { version: number; snapshot: unknown; createdAt: Date }[]
  > {
    return prisma.workflowVersion.findMany({
      where: { workflowId },
      orderBy: { version: 'desc' },
      select: { version: true, snapshot: true, createdAt: true },
    });
  }

  /** Récupère une version spécifique */
  async getVersion(workflowId: string, version: number): Promise<WorkflowDefinition | null> {
    const record = await prisma.workflowVersion.findUnique({
      where: { workflowId_version: { workflowId, version } },
    });
    if (!record) return null;
    return record.snapshot as unknown as WorkflowDefinition;
  }

  // --- Helpers privés ---

  /** Sauvegarde un snapshot de version */
  private async createVersion(
    workflowId: string,
    version: number,
    snapshot: unknown
  ): Promise<void> {
    await prisma.workflowVersion.create({
      data: {
        workflowId,
        version,
        snapshot: snapshot as Prisma.InputJsonValue,
      },
    });
  }

  /** Convertit un record Prisma en WorkflowDefinition */
  private toWorkflowDefinition(record: {
    id: string;
    name: string;
    description: string;
    version: number;
    status: WorkflowStatus;
    trigger: Prisma.JsonValue;
    steps: Prisma.JsonValue;
    variables: Prisma.JsonValue;
    tags: string[];
    organizationId: string;
    createdById: string;
    executionCount: number;
    lastExecutedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkflowDefinition {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      version: record.version,
      status: record.status,
      trigger: record.trigger as unknown as Trigger,
      steps: record.steps as unknown as Step[],
      variables: record.variables as unknown as Variable[],
      tags: record.tags,
      metadata: {
        createdBy: record.createdById,
        organizationId: record.organizationId,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
        lastExecutedAt: record.lastExecutedAt?.toISOString(),
        executionCount: record.executionCount,
      },
    };
  }
}
