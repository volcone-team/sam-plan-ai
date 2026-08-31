/**
 * Task Service
 * Manages tasks from initiative project templates.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type { Task, TaskStatus, TaskPriority, CreateTaskDTO, UpdateTaskDTO } from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';

export class TaskService {
  async getTasksByInitiative(initiativeId: string): Promise<Task[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('initiative_id', initiativeId)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    console.log("[task] No data, returning []"); return [];
  }

  async getTasksByCompany(companyId: string): Promise<Task[]> {
    if (!companyId) { console.log("[task] getTasksByCompany - no companyId"); return []; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('company_id', companyId)
          .order('due_date', { ascending: true });

        if (!error && data) {
          console.log("[task] getTasksByCompany:", data.length, "tasks");
          return data.map(row => this.mapRow(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }
    console.log("[task] getTasksByCompany - no data");
    return [];
  }

  async getTask(id: string): Promise<Task> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) {
          return this.mapRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getTasksByStatus(initiativeId: string, status: TaskStatus): Promise<Task[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('initiative_id', initiativeId)
          .eq('status', status)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    console.log("[task] No data, returning []"); return [];
  }

  async getTasksByPriority(initiativeId: string, priority: TaskPriority): Promise<Task[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('initiative_id', initiativeId)
          .eq('priority', priority);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    console.log("[task] No data, returning []"); return [];
  }

  async getBlockedTasks(initiativeId: string): Promise<Task[]> {
    return this.getTasksByStatus(initiativeId, 'blocked');
  }

  async getCriticalPathTasks(initiativeId: string): Promise<Task[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('initiative_id', initiativeId)
          .eq('priority', 'critical')
          .in('status', ['not_started', 'in_progress'])
          .gte('due_date', new Date().toISOString().split('T')[0])
          .order('due_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    console.log("[task] No data, returning []"); return [];
  }

  async getOverdueTasks(initiativeId: string): Promise<Task[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('initiative_id', initiativeId)
          .lt('due_date', new Date().toISOString().split('T')[0])
          .not('status', 'in', '("completed","cancelled")');

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    console.log("[task] No data, returning []"); return [];
  }

  async getTasksByDueDate(initiativeId: string, startDate: Date, endDate: Date): Promise<Task[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('initiative_id', initiativeId)
          .gte('due_date', startDate.toISOString().split('T')[0])
          .lte('due_date', endDate.toISOString().split('T')[0])
          .order('due_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    console.log("[task] No data, returning []"); return [];
  }

  async getTasksByAssignee(initiativeId: string, userId: string): Promise<Task[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('tasks')
          .select('*')
          .eq('initiative_id', initiativeId)
          .eq('assigned_to_user_id', userId);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    console.log("[task] No data, returning []"); return [];
  }

  async createTask(dto: CreateTaskDTO): Promise<Task> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          initiative_id: dto.initiativeId,
          company_id: dto.companyId,
          name: dto.name,
          description: dto.description || '',
          due_date: dto.dueDate instanceof Date ? dto.dueDate.toISOString().split('T')[0] : dto.dueDate,
          estimated_hours: dto.estimatedHours || 0,
          estimated_hours_range: dto.estimatedHoursRange || null,
          status: 'not_started',
          priority: dto.priority || 'medium',
          assigned_to_user_id: dto.assignedToUserId || null,
          dependency_ids: dto.dependencyIds || [],
          display_order: dto.displayOrder ?? 0,
        };

        const { data, error } = await supabase
          .from('tasks')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) {
          return this.mapRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async updateTask(id: string, dto: UpdateTaskDTO): Promise<Task> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const updateData: Record<string, unknown> = {};
        if (dto.name !== undefined) updateData.name = dto.name;
        if (dto.description !== undefined) updateData.description = dto.description;
        if (dto.status !== undefined) updateData.status = dto.status;
        if (dto.priority !== undefined) updateData.priority = dto.priority;
        if (dto.dueDate !== undefined) updateData.due_date = dto.dueDate instanceof Date ? dto.dueDate.toISOString().split('T')[0] : dto.dueDate;
        if (dto.estimatedHours !== undefined) updateData.estimated_hours = dto.estimatedHours;
        if (dto.actualHours !== undefined) updateData.actual_hours = dto.actualHours;
        if (dto.assignedToUserId !== undefined) updateData.assigned_to_user_id = dto.assignedToUserId || null;
        if (dto.completedAt !== undefined) updateData.completed_at = dto.completedAt instanceof Date ? dto.completedAt.toISOString() : dto.completedAt;
        if (dto.dependencyIds !== undefined) updateData.dependency_ids = dto.dependencyIds;
        if (dto.displayOrder !== undefined) updateData.display_order = dto.displayOrder;

        const { data, error } = await supabase
          .from('tasks')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          return this.mapRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[task] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    const completedAt = status === 'completed' ? new Date() : undefined;
    return this.updateTask(id, { status, completedAt });
  }

  async deleteTask(id: string): Promise<void> {
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', id);

      if (error) {
        console.error("[task] deleteTask error:", error.message);
        throw new Error(error.message);
      }
      console.log("[task] Deleted task:", id);
      return;
    }
    console.log("[task] deleteTask - Supabase not configured");
  }

  async startTask(id: string): Promise<Task> { return this.updateTaskStatus(id, 'in_progress'); }
  async completeTask(id: string): Promise<Task> { return this.updateTaskStatus(id, 'completed'); }
  async unblockTask(id: string): Promise<Task> { return this.updateTaskStatus(id, 'not_started'); }
  async cancelTask(id: string): Promise<Task> { return this.updateTaskStatus(id, 'cancelled'); }

  async assignTask(id: string, userId: string): Promise<Task> {
    return this.updateTask(id, { assignedToUserId: userId });
  }

  async logHours(id: string, hours: number): Promise<Task> {
    const task = await this.getTask(id);
    return this.updateTask(id, { actualHours: (task.actualHours || 0) + hours });
  }

  async getTaskProgress(id: string): Promise<number> {
    const task = await this.getTask(id);
    if (task.status === 'completed') return 100;
    if (task.status === 'cancelled') return 0;
    const estimated = task.estimatedHours || 1;
    const actual = task.actualHours || 0;
    return Math.min(Math.round((actual / estimated) * 100), 99);
  }

  async areDependenciesComplete(id: string): Promise<boolean> {
    const task = await this.getTask(id);
    if (!task.dependencyIds || task.dependencyIds.length === 0) return true;
    const deps = await Promise.all(task.dependencyIds.map(depId => this.getTask(depId)));
    return deps.every(t => t.status === 'completed');
  }

  async getTasksWithPendingDependencies(initiativeId: string): Promise<Task[]> {
    const tasks = await this.getTasksByInitiative(initiativeId);
    const result: Task[] = [];
    for (const task of tasks) {
      if (task.dependencyIds && task.dependencyIds.length > 0) {
        const complete = await this.areDependenciesComplete(task.id);
        if (!complete) result.push(task);
      }
    }
    return result;
  }

  private mapRow(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      initiativeId: row.initiative_id as string,
      companyId: row.company_id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      status: (row.status as TaskStatus) || 'not_started',
      priority: (row.priority as TaskPriority) || 'medium',
      dueDate: new Date(row.due_date as string),
      estimatedHours: Number(row.estimated_hours) || 0,
      estimatedHoursRange: row.estimated_hours_range as any,
      assignedToUserId: (row.assigned_to_user_id as string) || undefined,
      actualHours: row.actual_hours ? Number(row.actual_hours) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
      dependencyIds: (row.dependency_ids as string[]) || [],
      displayOrder: (row.display_order as number) || 0,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }



  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const taskService = new TaskService();
