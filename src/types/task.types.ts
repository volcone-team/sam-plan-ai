/**
 * Task domain types
 * Tasks come from initiative project templates and track execution
 */

export type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Task {
  id: string;
  initiativeId: string;
  companyId: string;
  // From template
  name: string;
  description: string;
  // Lead-time calculation: derived from initiative.eventDate + template.daysBeforeEvent
  dueDate: Date;
  estimatedHours: number;
  estimatedHoursRange?: {
    min: number;
    max: number;
  };
  // Execution tracking
  status: TaskStatus;
  priority: TaskPriority;
  assignedToUserId?: string;
  actualHours?: number;
  completedAt?: Date;
  // Task dependencies
  dependencyIds: string[]; // other task IDs that must complete first
  displayOrder: number;
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskDTO {
  initiativeId: string;
  companyId: string;
  name: string;
  description?: string;
  dueDate: Date;
  estimatedHours: number;
  estimatedHoursRange?: {
    min: number;
    max: number;
  };
  priority?: TaskPriority;
  assignedToUserId?: string;
  dependencyIds?: string[];
  displayOrder?: number;
}

export interface UpdateTaskDTO {
  name?: string;
  description?: string;
  dueDate?: Date;
  estimatedHours?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToUserId?: string;
  actualHours?: number;
  completedAt?: Date;
  dependencyIds?: string[];
  displayOrder?: number;
}
