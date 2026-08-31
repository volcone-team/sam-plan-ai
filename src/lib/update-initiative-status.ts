import { taskService } from '@/services/task.service';
import { initiativeService } from '@/services/initiative.service';

/**
 * Auto-updates initiative status based on its tasks.
 * - All tasks completed → initiative = 'completed'
 * - At least one task in_progress → initiative = 'in_progress' (launched)
 * - All tasks not_started → initiative stays as is
 *
 * Call this after every task status change.
 */
export async function updateInitiativeStatusFromTasks(initiativeId: string): Promise<void> {
  try {
    console.log("[autoStatus] Checking initiative:", initiativeId);

    const tasks = await taskService.getTasksByInitiative(initiativeId);

    if (tasks.length === 0) {
      console.log("[autoStatus] No tasks for initiative, skipping");
      return;
    }

    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
    const totalActive = tasks.filter(t => t.status !== 'cancelled').length;

    console.log("[autoStatus] Tasks:", totalActive, "total |", completedCount, "completed |", inProgressCount, "in progress");

    let newStatus: string | null = null;

    if (completedCount === totalActive && totalActive > 0) {
      newStatus = 'completed';
    } else if (inProgressCount > 0 || completedCount > 0) {
      newStatus = 'launched';
    }

    if (newStatus) {
      const initiative = await initiativeService.getInitiative(initiativeId);
      if (initiative.status !== newStatus && initiative.status !== 'completed') {
        console.log("[autoStatus] Updating initiative status:", initiative.status, "→", newStatus);
        await initiativeService.updateInitiative(initiativeId, { status: newStatus as any });
      } else {
        console.log("[autoStatus] Initiative already at:", initiative.status, "| computed:", newStatus);
      }
    }
  } catch (err) {
    console.error("[autoStatus] Error:", err);
    // Non-fatal — don't break the task toggle
  }
}
