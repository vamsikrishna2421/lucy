/**
 * Money goals (Vamsi #2) — storage + progress assembly. A goal is a target amount (optional deadline),
 * tracked by logged contributions; progress/pacing is computed by the pure processing/moneyGoals math.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { computeGoalProgress, type GoalProgress } from '../processing/moneyGoals';

export interface MoneyGoalRow {
  id: number;
  label: string;
  target_amount: number;
  currency: string;
  deadline: string | null;
  project_name: string | null;
  status: string;            // 'active' | 'done' | 'archived'
  created_at: string;
  resolved_at: string | null;
}

export interface GoalContributionRow { id: number; goal_id: number; amount: number; note: string | null; created_at: string }
export interface GoalWithProgress extends MoneyGoalRow { progress: GoalProgress }

export async function createMoneyGoal(
  db: SQLiteDatabase,
  opts: { label: string; target: number; currency?: string; deadline?: string | null; projectName?: string | null },
): Promise<number> {
  const res = await db.runAsync(
    'INSERT INTO money_goals (label, target_amount, currency, deadline, project_name) VALUES (?, ?, ?, ?, ?)',
    opts.label.trim(),
    opts.target,
    (opts.currency ?? '₹').trim() || '₹',
    opts.deadline ?? null,
    opts.projectName ?? null,
  );
  return res.lastInsertRowId;
}

/** Active + recently-completed goals (so a hit goal stays visible with its 🎉 until deleted). */
export async function listMoneyGoals(db: SQLiteDatabase): Promise<MoneyGoalRow[]> {
  return db.getAllAsync<MoneyGoalRow>(
    "SELECT * FROM money_goals WHERE status != 'archived' ORDER BY (status = 'done'), created_at DESC",
  );
}

export async function listContributions(db: SQLiteDatabase, goalId: number): Promise<GoalContributionRow[]> {
  return db.getAllAsync<GoalContributionRow>(
    'SELECT * FROM money_goal_contributions WHERE goal_id = ? ORDER BY created_at ASC, id ASC',
    goalId,
  );
}

/** Log a contribution (positive = saved toward it; negative = a withdrawal). Auto-completes the goal
 *  when the target is reached. */
export async function addContribution(db: SQLiteDatabase, goalId: number, amount: number, note: string | null = null): Promise<void> {
  if (!Number.isFinite(amount) || amount === 0) return;
  await db.runAsync('INSERT INTO money_goal_contributions (goal_id, amount, note) VALUES (?, ?, ?)', goalId, amount, note);
  const goal = await db.getFirstAsync<MoneyGoalRow>('SELECT * FROM money_goals WHERE id = ?', goalId);
  if (!goal) return;
  const saved = (await listContributions(db, goalId)).reduce((s, c) => s + c.amount, 0);
  if (saved >= goal.target_amount && goal.status === 'active') {
    await db.runAsync("UPDATE money_goals SET status = 'done', resolved_at = CURRENT_TIMESTAMP WHERE id = ?", goalId);
  } else if (saved < goal.target_amount && goal.status === 'done') {
    await db.runAsync("UPDATE money_goals SET status = 'active', resolved_at = NULL WHERE id = ?", goalId);
  }
}

export async function deleteMoneyGoal(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM money_goal_contributions WHERE goal_id = ?', id);
  await db.runAsync('DELETE FROM money_goals WHERE id = ?', id);
}

export async function getGoalsWithProgress(db: SQLiteDatabase, now = Date.now()): Promise<GoalWithProgress[]> {
  const goals = await listMoneyGoals(db);
  const out: GoalWithProgress[] = [];
  for (const g of goals) {
    const contribs = await listContributions(db, g.id);
    const progress = computeGoalProgress(
      g.target_amount,
      contribs.map((c) => ({ amount: c.amount, created_at: c.created_at })),
      g.created_at,
      g.deadline,
      now,
    );
    out.push({ ...g, progress });
  }
  return out;
}

export async function countActiveGoals(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM money_goals WHERE status = 'active'");
  return row?.n ?? 0;
}
