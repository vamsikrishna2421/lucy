import type { SQLiteDatabase } from 'expo-sqlite';
import { archiveReminder, listReminders, type ReminderRow } from '../db/reminders';
import { archiveTodo, listPendingTodos, type TodoRow } from '../db/todos';

const completedFragment = /^\s*(?:i\s+)?(?:paid(?:\s+it)?|payment\s+(?:is\s+)?done|rent\s+(?:is\s+)?paid)\s*[.!]?\s*$/i;
const expenseStatement = /^\s*(?:i\s+)?(?:paid|spent)\s+(?:\$\s*|usd\s*)?\d+(?:\.\d{1,2})?\b/i;

export function isInvalidPendingTask(task: Pick<TodoRow, 'task'>): boolean {
  return completedFragment.test(task.task) || expenseStatement.test(task.task);
}

export function isInvalidDeadline(reminder: Pick<ReminderRow, 'text'>): boolean {
  return expenseStatement.test(reminder.text);
}

export async function archiveMisclassifiedArtifacts(db: SQLiteDatabase): Promise<void> {
  const [tasks, reminders] = await Promise.all([listPendingTodos(db), listReminders(db)]);
  for (const task of tasks) {
    if (isInvalidPendingTask(task)) {
      await archiveTodo(
        db,
        task.id,
        'Expense or completion statement was incorrectly extracted as an active task.',
      );
    }
  }
  for (const reminder of reminders) {
    if (isInvalidDeadline(reminder)) {
      await archiveReminder(
        db,
        reminder.id,
        'Expense statement was incorrectly extracted as an active deadline.',
      );
    }
  }
}
