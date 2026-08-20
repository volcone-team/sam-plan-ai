/**
 * Task Service
 * Manages tasks from initiative project templates
 * Lead-time relative to initiative event dates
 */

import type { Task, TaskStatus, TaskPriority, CreateTaskDTO, UpdateTaskDTO } from '@/types';
import tasksData from '@/mock-data/tasks.json';

export class TaskService {
  /**
   * Get all tasks for an initiative
   */
  async getTasksByInitiative(initiativeId: string): Promise<Task[]> {
    await this.delay();
    
    return tasksData
      .filter(t => t.initiativeId === initiativeId)
      .map(t => this.transformTaskData(t));
  }

  /**
   * Get a specific task
   */
  async getTask(id: string): Promise<Task> {
    await this.delay();
    
    const task = tasksData.find(t => t.id === id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    return this.transformTaskData(task);
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(initiativeId: string, status: TaskStatus): Promise<Task[]> {
    await this.delay();
    
    return tasksData
      .filter(t => t.initiativeId === initiativeId && t.status === status)
      .map(t => this.transformTaskData(t));
  }

  /**
   * Get tasks by priority
   */
  async getTasksByPriority(
    initiativeId: string,
    priority: TaskPriority
  ): Promise<Task[]> {
    await this.delay();
    
    return tasksData
      .filter(t => t.initiativeId === initiativeId && t.priority === priority)
      .map(t => this.transformTaskData(t));
  }

  /**
   * Get blocked tasks (waiting on dependencies)
   */
  async getBlockedTasks(initiativeId: string): Promise<Task[]> {
    await this.delay();
    
    return tasksData
      .filter(t => t.initiativeId === initiativeId && t.status === 'blocked')
      .map(t => this.transformTaskData(t));
  }

  /**
   * Get critical path tasks
   * Tasks with tight deadlines and high priority
   */
  async getCriticalPathTasks(initiativeId: string): Promise<Task[]> {
    await this.delay();
    
    const now = new Date();
    return tasksData
      .filter(
        t =>
          t.initiativeId === initiativeId &&
          t.priority === 'critical' &&
          new Date(t.dueDate) > now &&
          (t.status === 'not_started' || t.status === 'in_progress')
      )
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .map(t => this.transformTaskData(t));
  }

  /**
   * Get overdue tasks
   */
  async getOverdueTasks(initiativeId: string): Promise<Task[]> {
    await this.delay();
    
    const now = new Date();
    return tasksData
      .filter(
        t =>
          t.initiativeId === initiativeId &&
          new Date(t.dueDate) < now &&
          t.status !== 'completed' &&
          t.status !== 'cancelled'
      )
      .map(t => this.transformTaskData(t));
  }

  /**
   * Get tasks due in a date range
   */
  async getTasksByDueDate(
    initiativeId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Task[]> {
    await this.delay();
    
    return tasksData
      .filter(
        t =>
          t.initiativeId === initiativeId &&
          new Date(t.dueDate) >= startDate &&
          new Date(t.dueDate) <= endDate
      )
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .map(t => this.transformTaskData(t));
  }

  /**
   * Get tasks assigned to a user
   */
  async getTasksByAssignee(
    initiativeId: string,
    userId: string
  ): Promise<Task[]> {
    await this.delay();
    
    return tasksData
      .filter(t => t.initiativeId === initiativeId && t.assignedToUserId === userId)
      .map(t => this.transformTaskData(t));
  }

  /**
   * Create a new task
   */
  async createTask(dto: CreateTaskDTO): Promise<Task> {
    await this.delay();
    
    const newTask = {
      id: `task-${Date.now()}`,
      ...dto,
      dueDate: dto.dueDate instanceof Date ? dto.dueDate.toISOString() : dto.dueDate,
      status: 'not_started' as TaskStatus,
      actualHours: 0,
      dependencyIds: dto.dependencyIds || [],
      displayOrder: dto.displayOrder ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (tasksData as any[]).push(newTask);
    return this.transformTaskData(newTask as any);
  }

  /**
   * Update task
   */
  async updateTask(id: string, dto: UpdateTaskDTO): Promise<Task> {
    await this.delay();
    
    const index = tasksData.findIndex(t => t.id === id);
    if (index === -1) {
      throw new Error(`Task ${id} not found`);
    }

    const updated = {
      ...tasksData[index],
      ...dto,
      dueDate: dto.dueDate ? (dto.dueDate instanceof Date ? dto.dueDate.toISOString() : dto.dueDate) : tasksData[index].dueDate,
      completedAt: dto.completedAt ? (dto.completedAt instanceof Date ? dto.completedAt.toISOString() : dto.completedAt) : (tasksData[index] as any).completedAt,
      updatedAt: new Date().toISOString(),
    } as any;

    tasksData[index] = updated;
    return this.transformTaskData(updated);
  }

  /**
   * Update task status
   */
  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.updateTask(id, { status });
  }

  /**
   * Mark task as in progress
   */
  async startTask(id: string): Promise<Task> {
    return this.updateTaskStatus(id, 'in_progress');
  }

  /**
   * Complete a task
   */
  async completeTask(id: string): Promise<Task> {
    return this.updateTaskStatus(id, 'completed');
  }

  /**
   * Unblock a task
   */
  async unblockTask(id: string): Promise<Task> {
    return this.updateTaskStatus(id, 'not_started');
  }

  /**
   * Cancel a task
   */
  async cancelTask(id: string): Promise<Task> {
    return this.updateTaskStatus(id, 'cancelled');
  }

  /**
   * Assign task to a user
   */
  async assignTask(id: string, userId: string): Promise<Task> {
    return this.updateTask(id, { assignedToUserId: userId });
  }

  /**
   * Log actual hours on a task
   */
  async logHours(id: string, hours: number): Promise<Task> {
    const task = await this.getTask(id);
    return this.updateTask(id, {
      actualHours: (task.actualHours || 0) + hours,
    });
  }

  /**
   * Get task progress percentage
   */
  async getTaskProgress(id: string): Promise<number> {
    const task = await this.getTask(id);
    
    if (task.status === 'completed') return 100;
    if (task.status === 'cancelled') return 0;
    
    const estimatedHours = task.estimatedHours || 1;
    const actualHours = task.actualHours || 0;
    return Math.min(Math.round((actualHours / estimatedHours) * 100), 99);
  }

  /**
   * Check if all dependencies are completed
   */
  async areDependenciesComplete(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    
    if (!task.dependencyIds || task.dependencyIds.length === 0) {
      return true;
    }

    const dependencyTasks = await Promise.all(
      task.dependencyIds.map(depId => this.getTask(depId))
    );

    return dependencyTasks.every(t => t.status === 'completed');
  }

  /**
   * Get tasks with unmet dependencies
   */
  async getTasksWithPendingDependencies(initiativeId: string): Promise<Task[]> {
    await this.delay();
    
    const tasks = await this.getTasksByInitiative(initiativeId);
    const tasksWithPending: Task[] = [];

    for (const task of tasks) {
      if (task.dependencyIds && task.dependencyIds.length > 0) {
        const areDepsComplete = await this.areDependenciesComplete(task.id);
        if (!areDepsComplete) {
          tasksWithPending.push(task);
        }
      }
    }

    return tasksWithPending;
  }

  /**
   * Transform task data
   */
  private transformTaskData(data: typeof tasksData[0]): Task {
    return {
      id: data.id,
      initiativeId: data.initiativeId,
      companyId: (data as any).companyId,
      name: data.name,
      description: data.description,
      status: (data.status as TaskStatus) || 'not_started',
      priority: (data.priority as TaskPriority) || 'medium',
      dueDate: new Date(data.dueDate),
      estimatedHours: data.estimatedHours,
      estimatedHoursRange: (data as any).estimatedHoursRange,
      assignedToUserId: data.assignedToUserId,
      actualHours: data.actualHours,
      completedAt: (data as any).completedAt ? new Date((data as any).completedAt) : undefined,
      dependencyIds: data.dependencyIds || [],
      displayOrder: (data as any).displayOrder || 0,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Simulate network delay
   */
  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const taskService = new TaskService();
