import type { Prisma, Todo } from "@prisma/client";
import type { TodoDTO } from "@/app/api/todos/route";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The list order everywhere: priority S→C, then the earliest due date (no
 * due date last), then the manual ↑↓ order among otherwise equal TODOs.
 */
export const TODO_ORDER = [
  { priority: "asc" },
  { dueDate: { sort: "asc", nulls: "last" } },
  { position: "asc" },
  { createdAt: "asc" },
] satisfies Prisma.TodoOrderByWithRelationInput[];

// due_date is a Postgres `date`, which Prisma hands back as UTC midnight.
// Keep it as a plain "YYYY-MM-DD" string on the wire so the browser can
// compare it with its own local date without any time zone shift.
export function toTodoDTO(todo: Todo): TodoDTO {
  return {
    id: todo.id,
    parentId: todo.parentId,
    title: todo.title,
    isCompleted: todo.isCompleted,
    priority: todo.priority,
    position: todo.position,
    dueDate: todo.dueDate ? todo.dueDate.toISOString().slice(0, 10) : null,
    createdAt: todo.createdAt.toISOString(),
  };
}

/** The whole list in display order, for responses that touch several rows. */
export function listTodos(tx: Prisma.TransactionClient, userId: string) {
  return tx.todo.findMany({ where: { userId }, orderBy: TODO_ORDER });
}

/**
 * The next position at the bottom of a sibling group (same parent and
 * priority), so a TODO added or moved there lands last.
 */
export async function nextPosition(
  tx: Prisma.TransactionClient,
  where: {
    userId: string;
    parentId: string | null;
    priority: Todo["priority"];
  },
) {
  const { _max } = await tx.todo.aggregate({ where, _max: { position: true } });
  return (_max.position ?? 0) + 1;
}

/**
 * A parent with subtasks is complete exactly when all of them are. Call after
 * any change to a parent's set of subtasks or to one subtask's completion.
 * A parent left with no subtasks keeps whatever state it had.
 */
export async function syncParentCompletion(
  tx: Prisma.TransactionClient,
  parentId: string,
) {
  const subtasks = await tx.todo.findMany({
    where: { parentId },
    select: { isCompleted: true },
  });
  if (subtasks.length === 0) return;

  await tx.todo.update({
    where: { id: parentId },
    data: { isCompleted: subtasks.every((subtask) => subtask.isCompleted) },
  });
}

/**
 * Parses a "YYYY-MM-DD" string (or null to clear) from a request body.
 * Returns undefined when the value is malformed.
 */
export function parseDueDate(value: unknown): Date | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return undefined;

  const date = new Date(`${value}T00:00:00Z`);
  // Rejects dates like 2026-02-31, which Date silently rolls over.
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return undefined;
  }
  return date;
}
