'use client';

import { useCompanyId } from '@/hooks/use-auth';
import { useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  Circle,
  Loader2,
  Ban,
  AlertTriangle,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  ListTodo,
} from 'lucide-react';
import type { Task, TaskStatus, TaskPriority } from '@/types';
import { taskService } from '@/services/task.service';

export interface InitiativeTasksProps {
  initiativeId: string;
}


const statusConfig: Record<TaskStatus, { icon: typeof Circle; color: string; bgColor: string; label: string }> = {
  not_started: { icon: Circle, color: 'text-gray-400', bgColor: 'bg-gray-100', label: 'Not Started' },
  in_progress: { icon: Loader2, color: 'text-blue-500', bgColor: 'bg-blue-50', label: 'In Progress' },
  completed: { icon: CheckCircle2, color: 'text-green-500', bgColor: 'bg-green-50', label: 'Completed' },
  blocked: { icon: AlertTriangle, color: 'text-red-500', bgColor: 'bg-red-50', label: 'Blocked' },
  cancelled: { icon: Ban, color: 'text-gray-400', bgColor: 'bg-gray-50', label: 'Cancelled' },
};

const priorityConfig: Record<TaskPriority, { color: string; bgColor: string; label: string }> = {
  low: { color: 'text-gray-600', bgColor: 'bg-gray-100', label: 'Low' },
  medium: { color: 'text-amber-700', bgColor: 'bg-amber-50', label: 'Medium' },
  high: { color: 'text-orange-700', bgColor: 'bg-orange-50', label: 'High' },
  critical: { color: 'text-red-700', bgColor: 'bg-red-50', label: 'Critical' },
};


interface TaskFormData {
  name: string;
  description: string;
  priority: TaskPriority;
  dueDate: string;
  estimatedHours: number;
  assignedTo: string;
}


export function InitiativeTasks({ initiativeId }: InitiativeTasksProps) {
  const companyId = useCompanyId() || "";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, [initiativeId]);

  const loadTasks = async () => {
    try {
      setLoading(true);
      const data = await taskService.getTasksByInitiative(initiativeId);
      data.sort((a, b) => a.displayOrder - b.displayOrder || new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      setTasks(data);
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    try {
      await taskService.updateTaskStatus(taskId, newStatus);
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handleAddTask = async (formData: TaskFormData) => {
    try {
      const newTask = await taskService.createTask({
        initiativeId,
        companyId: companyId,
        name: formData.name,
        description: formData.description,
        priority: formData.priority,
        dueDate: new Date(formData.dueDate),
        estimatedHours: formData.estimatedHours,
        assignedToUserId: formData.assignedTo || undefined,
        displayOrder: tasks.length + 1,
      });
      setTasks(prev => [...prev, newTask]);
      setShowAddForm(false);
    } catch (err) {
      console.error('Failed to add task:', err);
    }
  };

  const handleEditTask = async (taskId: string, formData: TaskFormData) => {
    try {
      const updated = await taskService.updateTask(taskId, {
        name: formData.name,
        description: formData.description,
        priority: formData.priority,
        dueDate: new Date(formData.dueDate),
        estimatedHours: formData.estimatedHours,
      });
      setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
      setEditingTaskId(null);
    } catch (err) {
      console.error('Failed to update task:', err);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      // Remove from local state (mock service mutates array)
      setTasks(prev => prev.filter(t => t.id !== taskId));
      setDeleteConfirmId(null);
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading tasks...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with add button */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Tasks ({tasks.length})
        </h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add Task
        </button>
      </div>

      {/* Add task form */}
      {showAddForm && (
        <TaskForm
          onSubmit={handleAddTask}
          onCancel={() => setShowAddForm(false)}
          title="Add New Task"
        />
      )}

      {/* Task list */}
      {tasks.length === 0 && !showAddForm ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <ListTodo className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">No tasks yet</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            Add your first task to start tracking execution.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              isExpanded={expandedTaskId === task.id}
              isEditing={editingTaskId === task.id}
              isDeleting={deleteConfirmId === task.id}
              onToggleExpand={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
              onStatusChange={(status) => handleStatusChange(task.id, status)}
              onEdit={() => setEditingTaskId(task.id)}
              onCancelEdit={() => setEditingTaskId(null)}
              onSaveEdit={(data) => handleEditTask(task.id, data)}
              onDelete={() => setDeleteConfirmId(task.id)}
              onConfirmDelete={() => handleDeleteTask(task.id)}
              onCancelDelete={() => setDeleteConfirmId(null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


/* ─────────────────────────────────────────────────
 * Task Row
 * ───────────────────────────────────────────────── */

interface TaskRowProps {
  task: Task;
  isExpanded: boolean;
  isEditing: boolean;
  isDeleting: boolean;
  onToggleExpand: () => void;
  onStatusChange: (status: TaskStatus) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: TaskFormData) => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

function TaskRow({
  task,
  isExpanded,
  isEditing,
  isDeleting,
  onToggleExpand,
  onStatusChange,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: TaskRowProps) {
  const config = statusConfig[task.status];
  const Icon = config.icon;
  const priority = priorityConfig[task.priority] || priorityConfig.medium;
  const isOverdue = new Date(task.dueDate) < new Date() && task.status !== 'completed' && task.status !== 'cancelled';

  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  return (
    <div className={`rounded-[var(--radius-lg)] border bg-card transition-colors ${isOverdue ? 'border-red-200' : 'border-border'}`}>
      {/* Main row */}
      <div className="flex items-center gap-3 p-4">
        {/* Status icon - clickable for quick status cycle */}
        <button
          onClick={() => {
            const nextStatus: Record<TaskStatus, TaskStatus> = {
              not_started: 'in_progress',
              in_progress: 'completed',
              completed: 'not_started',
              blocked: 'in_progress',
              cancelled: 'not_started',
            };
            onStatusChange(nextStatus[task.status]);
          }}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${config.bgColor} hover:ring-2 hover:ring-[hsl(var(--primary))] transition-all`}
          title={`Status: ${config.label}. Click to change.`}
        >
          <Icon className={`h-4 w-4 ${config.color}`} />
        </button>

        {/* Task info */}
        <button onClick={onToggleExpand} className="flex-1 min-w-0 text-left">
          <h3 className={`text-sm font-medium ${task.status === 'cancelled' ? 'line-through text-[hsl(var(--foreground-muted))]' : 'text-[hsl(var(--foreground))]'}`}>
            {task.name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--foreground-muted))]">
            <span className={`inline-flex items-center gap-1 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
              <Calendar className="h-3 w-3" />
              {formatDate(task.dueDate)}
              {isOverdue && ' (overdue)'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {task.estimatedHours}h
            </span>
            {task.assignedToUserId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5">
                <span className="h-3 w-3 rounded-full bg-[hsl(var(--primary)_/_0.3)] flex items-center justify-center text-[8px] font-bold text-[hsl(var(--primary))]">
                  {task.assignedToUserId.slice(0, 1).toUpperCase()}
                </span>
                <span className="text-[11px]">Assigned</span>
              </span>
            )}
            {!task.assignedToUserId && (
              <span className="inline-flex items-center gap-1 text-[11px] italic opacity-60">
                Unassigned
              </span>
            )}
          </div>
        </button>

        {/* Badges */}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${priority.bgColor} ${priority.color}`}>
          {priority.label}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${config.bgColor} ${config.color}`}>
          {config.label}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded hover:bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]" title="Edit">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-50 text-[hsl(var(--foreground-muted))] hover:text-red-600" title="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={onToggleExpand} className="p-1.5 rounded hover:bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]">
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {isDeleting && (
        <div className="border-t border-border bg-red-50 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-red-700">Delete this task?</span>
          <div className="flex gap-2">
            <button onClick={onCancelDelete} className="px-3 py-1 text-xs font-medium rounded border border-border bg-white hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={onConfirmDelete} className="px-3 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700">
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && !isEditing && (
        <div className="border-t border-border px-4 py-4 space-y-3">
          {task.description && (
            <div>
              <p className="text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Description</p>
              <p className="text-sm text-[hsl(var(--foreground))]">{task.description}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Estimated</p>
              <p className="text-sm font-medium">{task.estimatedHours}h</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Actual</p>
              <p className="text-sm font-medium">{task.actualHours || 0}h</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Due Date</p>
              <p className="text-sm font-medium">{formatDate(task.dueDate)}</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Dependencies</p>
              <p className="text-sm font-medium">{task.dependencyIds?.length || 0} task(s)</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Assigned to</p>
              <p className="text-sm font-medium">{task.assignedToUserId || 'Unassigned'}</p>
            </div>
          </div>

          {/* Quick status buttons */}
          <div className="pt-2 border-t border-border">
            <p className="text-xs font-medium text-[hsl(var(--foreground-muted))] mb-2">Change Status</p>
            <div className="flex flex-wrap gap-2">
              {(['not_started', 'in_progress', 'completed', 'blocked', 'cancelled'] as TaskStatus[]).map(s => {
                const sc = statusConfig[s];
                const isActive = task.status === s;
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange(s)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? 'ring-2 ring-[hsl(var(--primary))] ' + sc.bgColor + ' ' + sc.color
                        : 'border border-border hover:border-[hsl(var(--primary))] ' + sc.color
                    }`}
                  >
                    {sc.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Edit form */}
      {isEditing && (
        <div className="border-t border-border px-4 py-4">
          <TaskForm
            initialData={{
              name: task.name,
              description: task.description || '',
              priority: task.priority,
              dueDate: new Date(task.dueDate).toISOString().split('T')[0],
              estimatedHours: task.estimatedHours,
              assignedTo: task.assignedToUserId || '',
            }}
            onSubmit={onSaveEdit}
            onCancel={onCancelEdit}
            title="Edit Task"
            submitLabel="Save Changes"
          />
        </div>
      )}
    </div>
  );
}


/* ─────────────────────────────────────────────────
 * Task Form (shared for Add and Edit)
 * ───────────────────────────────────────────────── */

interface TaskFormProps {
  initialData?: TaskFormData;
  onSubmit: (data: TaskFormData) => void;
  onCancel: () => void;
  title: string;
  submitLabel?: string;
}

function TaskForm({ initialData, onSubmit, onCancel, title, submitLabel = 'Add Task' }: TaskFormProps) {
  const [formData, setFormData] = useState<TaskFormData>(
    initialData || {
      name: '',
      description: '',
      priority: 'medium',
      dueDate: new Date().toISOString().split('T')[0],
      estimatedHours: 2,
      assignedTo: '',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h3>
        <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-[hsl(var(--background-muted))]">
          <X className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        </button>
      </div>

      {/* Name */}
      <div>
        <label htmlFor="task-name" className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Task Name *
        </label>
        <input
          id="task-name"
          type="text"
          required
          value={formData.name}
          onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
          className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] transition-colors"
          placeholder="Enter task name..."
        />
      </div>

      {/* Description */}
      <div>
        <label htmlFor="task-desc" className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Description
        </label>
        <textarea
          id="task-desc"
          rows={2}
          value={formData.description}
          onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
          className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] transition-colors resize-none"
          placeholder="Describe the task..."
        />
      </div>

      {/* Row: Priority, Due Date, Hours */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="task-priority" className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Priority
          </label>
          <select
            id="task-priority"
            value={formData.priority}
            onChange={e => setFormData(prev => ({ ...prev, priority: e.target.value as TaskPriority }))}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        <div>
          <label htmlFor="task-due" className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Due Date
          </label>
          <input
            id="task-due"
            type="date"
            value={formData.dueDate}
            onChange={e => setFormData(prev => ({ ...prev, dueDate: e.target.value }))}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
          />
        </div>

        <div>
          <label htmlFor="task-hours" className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Estimated Hours
          </label>
          <input
            id="task-hours"
            type="number"
            min="0.5"
            step="0.5"
            value={formData.estimatedHours}
            onChange={e => setFormData(prev => ({ ...prev, estimatedHours: parseFloat(e.target.value) || 0 }))}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
          />
        </div>
      </div>

      {/* Assigned To */}
      <div>
        <label htmlFor="task-assignee" className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
          Assign to
        </label>
        <input
          id="task-assignee"
          type="text"
          value={formData.assignedTo}
          onChange={e => setFormData(prev => ({ ...prev, assignedTo: e.target.value }))}
          className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] transition-colors"
          placeholder="e.g. Sarah, Marcus, or leave blank"
        />
        <p className="mt-1 text-[11px] text-[hsl(var(--foreground-muted))]">Who is responsible for this task?</p>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] border border-border hover:bg-[hsl(var(--background-muted))] transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
