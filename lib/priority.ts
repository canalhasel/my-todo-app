// Shared by the API and the browser, so it must not import @prisma/client.
// Order matters: it is the display order, S first.
export const PRIORITIES = ["S", "A", "B", "C"] as const;

export type Priority = (typeof PRIORITIES)[number];

export const DEFAULT_PRIORITY: Priority = "B";

export function isPriority(value: unknown): value is Priority {
  return PRIORITIES.includes(value as Priority);
}
