"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEFAULT_PRIORITY, PRIORITIES, type Priority } from "@/lib/priority";
import type {
  CreateTodoRequestBody,
  CreateTodoResponse,
  GetTodosResponse,
  TodoDTO,
} from "@/app/api/todos/route";
import type {
  DeleteTodoResponse,
  UpdateTodoRequestBody,
  UpdateTodoResponse,
} from "@/app/api/todos/[id]/route";
import type {
  MoveTodoRequestBody,
  MoveTodoResponse,
} from "@/app/api/todos/[id]/position/route";

const PRIORITY_STYLES: Record<Priority, string> = {
  S: "border-red-500/40 bg-red-500/15 text-red-300",
  A: "border-orange-500/40 bg-orange-500/15 text-orange-300",
  B: "border-sky-500/40 bg-sky-500/15 text-sky-300",
  C: "border-white/15 bg-white/5 text-neutral-400",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const TOP_COUNT = 5;

const VIEWS = [
  { id: "all", label: "すべての TODO" },
  { id: "top", label: `優先度上位${TOP_COUNT}位` },
  { id: "due", label: "今日まで" },
] as const;

type View = (typeof VIEWS)[number]["id"];

type NewTodo = { title: string; priority: Priority; dueDate: string | null };

/** The browser's local date as "YYYY-MM-DD", matching TodoDTO.dueDate. */
function localDateString(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "2026-09-30" → "9/30(水)" */
function formatDueDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${m}/${d}(${weekday})`;
}

/** "YYYY-MM-DD" strings sort chronologically; no due date goes last. */
function compareDueDates(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Same order as the API's TODO_ORDER: priority S→C, then the earliest due
 * date, then the manual ↑↓ order.
 */
function sortTodos(todos: TodoDTO[]) {
  return [...todos].sort(
    (a, b) =>
      PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
      compareDueDates(a.dueDate, b.dueDate) ||
      a.position - b.position ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * ↑↓ only reorders siblings the sort leaves tied: same parent, priority and
 * due date.
 */
function isSwappable(a: TodoDTO | undefined, b: TodoDTO | undefined) {
  return (
    !!a &&
    !!b &&
    a.parentId === b.parentId &&
    a.priority === b.priority &&
    a.dueDate === b.dueDate
  );
}

/** Mirrors the server's swap so ↑↓ feel instant; the response replaces it. */
function swapWithNeighbour(
  todos: TodoDTO[],
  id: string,
  direction: MoveTodoRequestBody["direction"],
) {
  const target = todos.find((t) => t.id === id);
  if (!target) return todos;
  const siblings = todos.filter((t) => t.parentId === target.parentId);
  const index = siblings.indexOf(target);
  const neighbour = siblings[direction === "up" ? index - 1 : index + 1];
  if (!isSwappable(target, neighbour)) return todos;

  return sortTodos(
    todos.map((t) =>
      t.id === target.id
        ? { ...t, position: neighbour.position }
        : t.id === neighbour.id
          ? { ...t, position: target.position }
          : t,
    ),
  );
}

/** Optimistic version of the server's parent → subtasks completion cascade. */
function applyChanges(
  todos: TodoDTO[],
  todo: TodoDTO,
  changes: UpdateTodoRequestBody,
) {
  return sortTodos(
    todos.map((t) => {
      if (t.id === todo.id) return { ...t, ...changes };
      if (t.parentId === todo.id && changes.isCompleted !== undefined) {
        return { ...t, isCompleted: changes.isCompleted };
      }
      return t;
    }),
  );
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (value: Priority) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-neutral-400">
        優先度
      </legend>
      <div className="flex gap-1.5">
        {PRIORITIES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-pressed={value === p}
            className={`size-9 rounded-lg border text-sm font-bold transition ${
              value === p
                ? PRIORITY_STYLES[p]
                : "border-white/10 text-neutral-500 hover:border-white/20 hover:text-neutral-300"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Used both for new TODOs and, inline under a parent, for subtasks. */
function AddTodoForm({
  placeholder,
  initialPriority = DEFAULT_PRIORITY,
  autoFocus = false,
  onAdd,
  onCancel,
}: {
  placeholder: string;
  initialPriority?: Priority;
  autoFocus?: boolean;
  /** Resolves to true when the TODO was added, which clears the form. */
  onAdd: (todo: NewTodo) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>(initialPriority);
  const [dueDate, setDueDate] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setIsAdding(true);
    const added = await onAdd({
      title: trimmed,
      priority,
      dueDate: dueDate || null,
    });
    setIsAdding(false);

    if (added) {
      setTitle("");
      setPriority(initialPriority);
      setDueDate("");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
      />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <PriorityPicker value={priority} onChange={setPriority} />

        <label className="flex flex-col">
          <span className="mb-1.5 text-xs font-medium text-neutral-400">
            期限日（任意）
          </span>
          <input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-neutral-950 px-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
          />
        </label>

        <div className="flex gap-2 sm:ml-auto">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="h-9 rounded-lg border border-white/10 px-4 text-sm text-neutral-400 transition hover:border-white/20 hover:text-white"
            >
              キャンセル
            </button>
          )}
          <button
            type="submit"
            disabled={isAdding || !title.trim()}
            className="h-9 shrink-0 rounded-lg bg-indigo-500 px-5 text-sm font-semibold text-white transition hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAdding ? "追加中..." : "追加"}
          </button>
        </div>
      </div>
    </form>
  );
}

function DueDateChip({
  value,
  today,
  disabled,
  onChange,
}: {
  value: string | null;
  today: string;
  disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isToday = value === today;
  const isOverdue = value !== null && value < today;

  function openPicker() {
    const input = inputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        title="期限日を変更"
        className={`rounded-full border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 ${
          isOverdue
            ? "border-red-500/40 bg-red-500/15 font-medium text-red-300"
            : isToday
              ? "border-amber-500/40 bg-amber-500/15 font-medium text-amber-300"
              : value
                ? "border-white/15 text-neutral-300 hover:border-white/30"
                : "border-dashed border-white/15 text-neutral-500 hover:border-white/30 hover:text-neutral-300"
        }`}
      >
        {value
          ? `期限日 ${formatDueDate(value)}${
              isOverdue ? "・期限切れ" : isToday ? "・今日" : ""
            }`
          : "期限日なし"}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="期限日を外す"
          className="ml-1 text-xs text-neutral-500 transition hover:text-neutral-300 disabled:opacity-60"
        >
          ×
        </button>
      )}
      {/* Invisible, but still rendered so the native picker anchors here. */}
      <input
        ref={inputRef}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
        className="pointer-events-none absolute inset-0 opacity-0"
      />
    </span>
  );
}

const SMALL_BUTTON =
  "shrink-0 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60";

function TodoRow({
  todo,
  today,
  isPending,
  move,
  parentTitle,
  subtaskProgress,
  onUpdate,
  onAddSubtask,
  onPromote,
  onDelete,
}: {
  todo: TodoDTO;
  today: string;
  isPending: boolean;
  /** ↑↓ controls; omitted in filtered views, where neighbours may be hidden. */
  move?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    disabled: boolean;
    onMove: (direction: MoveTodoRequestBody["direction"]) => void;
  };
  /** Shown on a subtask listed outside its parent (filtered views). */
  parentTitle?: string;
  subtaskProgress?: { done: number; total: number };
  onUpdate: (changes: UpdateTodoRequestBody, errorMessage: string) => void;
  onAddSubtask?: () => void;
  onPromote?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-white/10 bg-neutral-950 px-3 py-3">
      {move && (
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => move.onMove("up")}
            disabled={move.disabled || !move.canMoveUp}
            aria-label="上へ（優先度・期限日が同じ TODO の中で）"
            className="px-1 text-xs leading-4 text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => move.onMove("down")}
            disabled={move.disabled || !move.canMoveDown}
            aria-label="下へ（優先度・期限日が同じ TODO の中で）"
            className="px-1 text-xs leading-4 text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
          >
            ↓
          </button>
        </div>
      )}
      <input
        type="checkbox"
        checked={todo.isCompleted}
        onChange={() =>
          onUpdate({ isCompleted: !todo.isCompleted }, "更新に失敗しました。")
        }
        disabled={isPending}
        className="size-4 shrink-0 rounded border-white/20 bg-neutral-900 accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <select
        value={todo.priority}
        onChange={(event) =>
          onUpdate(
            { priority: event.target.value as Priority },
            "優先度の変更に失敗しました。",
          )
        }
        disabled={isPending}
        aria-label="優先度"
        title="優先度を変更"
        className={`shrink-0 cursor-pointer appearance-none rounded border px-2 py-0.5 text-center text-xs font-bold outline-none disabled:opacity-60 ${PRIORITY_STYLES[todo.priority]}`}
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p} className="bg-neutral-900 text-white">
            {p}
          </option>
        ))}
      </select>
      <span className="min-w-0 flex-1">
        {parentTitle && (
          <span className="block truncate text-xs text-neutral-500">
            ↳ {parentTitle} のサブタスク
          </span>
        )}
        <span
          className={`block truncate text-sm ${
            todo.isCompleted ? "text-neutral-500 line-through" : "text-white"
          }`}
        >
          {todo.title}
        </span>
      </span>
      {subtaskProgress && (
        <span
          title="完了したサブタスク / サブタスクの数"
          className="shrink-0 text-xs text-neutral-500"
        >
          {subtaskProgress.done}/{subtaskProgress.total}
        </span>
      )}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <DueDateChip
          value={todo.dueDate}
          today={today}
          disabled={isPending}
          onChange={(value) => {
            if (value === todo.dueDate) return;
            onUpdate({ dueDate: value }, "期限日の更新に失敗しました。");
          }}
        />
        {onAddSubtask && (
          <button
            type="button"
            onClick={onAddSubtask}
            disabled={isPending}
            className={SMALL_BUTTON}
          >
            ＋ サブタスク
          </button>
        )}
        {onPromote && (
          <button
            type="button"
            onClick={onPromote}
            disabled={isPending}
            title="サブタスクを独立した TODO にする"
            className={SMALL_BUTTON}
          >
            格上げ
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          disabled={isPending}
          className={`${SMALL_BUTTON} hover:border-red-500/40 hover:text-red-300`}
        >
          削除
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [todos, setTodos] = useState<TodoDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [isReordering, setIsReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");
  /** The parent whose inline "add subtask" form is open. */
  const [subtaskParentId, setSubtaskParentId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/todos")
      .then((res) => res.json() as Promise<GetTodosResponse>)
      .then((data) => {
        if (!cancelled) setTodos(data.todos);
      })
      .catch(() => {
        if (!cancelled) setError("TODO の取得に失敗しました。");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignOut() {
    setIsSigningOut(true);

    const supabase = createClient();
    await supabase.auth.signOut();

    router.replace("/login");
    router.refresh();
  }

  function setPending(id: string, isPending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (isPending) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleAdd(todo: NewTodo, parentId: string | null = null) {
    setError(null);

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...todo,
          parentId,
        } satisfies CreateTodoRequestBody),
      });

      if (!res.ok) throw new Error();

      const data = (await res.json()) as CreateTodoResponse;
      setTodos(data.todos);
      return true;
    } catch {
      setError(
        parentId
          ? "サブタスクの追加に失敗しました。"
          : "TODO の追加に失敗しました。",
      );
      return false;
    }
  }

  async function handleUpdate(
    todo: TodoDTO,
    changes: UpdateTodoRequestBody,
    errorMessage: string,
  ) {
    const previous = todos;
    setPending(todo.id, true);
    setError(null);
    setTodos(applyChanges(previous, todo, changes));

    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes satisfies UpdateTodoRequestBody),
      });

      if (!res.ok) throw new Error();

      const data = (await res.json()) as UpdateTodoResponse;
      setTodos(data.todos);
    } catch {
      setTodos(previous);
      setError(errorMessage);
    } finally {
      setPending(todo.id, false);
    }
  }

  async function handleMove(
    id: string,
    direction: MoveTodoRequestBody["direction"],
  ) {
    const previous = todos;
    setIsReordering(true);
    setError(null);
    setTodos(swapWithNeighbour(previous, id, direction));

    try {
      const res = await fetch(`/api/todos/${id}/position`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction } satisfies MoveTodoRequestBody),
      });

      if (!res.ok) throw new Error();

      const data = (await res.json()) as MoveTodoResponse;
      setTodos(data.todos);
    } catch {
      setTodos(previous);
      setError("並び替えに失敗しました。");
    } finally {
      setIsReordering(false);
    }
  }

  async function handleDelete(todo: TodoDTO) {
    const subtaskCount = todos.filter((t) => t.parentId === todo.id).length;
    if (
      subtaskCount > 0 &&
      !window.confirm(
        `「${todo.title}」を削除すると、サブタスク ${subtaskCount} 件も一緒に削除されます。よろしいですか？`,
      )
    ) {
      return;
    }

    setPending(todo.id, true);
    setError(null);

    try {
      const res = await fetch(`/api/todos/${todo.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();

      const data = (await res.json()) as DeleteTodoResponse;
      setTodos(data.todos);
    } catch {
      setError("削除に失敗しました。");
    } finally {
      setPending(todo.id, false);
    }
  }

  const today = localDateString(new Date());

  // `todos` is already sorted, so filtering keeps the order.
  const parents = todos.filter((todo) => todo.parentId === null);
  const subtasksOf = (id: string) => todos.filter((t) => t.parentId === id);
  const titleOf = (id: string | null) => todos.find((t) => t.id === id)?.title;

  // The filtered views list parents and subtasks alike, each on its own merit.
  const viewCounts: Record<View, number> = {
    all: todos.length,
    top: Math.min(todos.filter((t) => !t.isCompleted).length, TOP_COUNT),
    due: todos.filter((t) => t.dueDate !== null && t.dueDate <= today).length,
  };
  const filteredTodos =
    view === "top"
      ? todos.filter((t) => !t.isCompleted).slice(0, TOP_COUNT)
      : todos.filter((t) => t.dueDate !== null && t.dueDate <= today);

  function renderRow(todo: TodoDTO, siblings: TodoDTO[] | null) {
    const subtasks = subtasksOf(todo.id);
    const index = siblings?.indexOf(todo) ?? -1;

    return (
      <TodoRow
        todo={todo}
        today={today}
        isPending={pendingIds.has(todo.id)}
        move={
          siblings
            ? {
                canMoveUp: isSwappable(todo, siblings[index - 1]),
                canMoveDown: isSwappable(todo, siblings[index + 1]),
                disabled: isReordering,
                onMove: (direction) => handleMove(todo.id, direction),
              }
            : undefined
        }
        parentTitle={
          siblings === null && todo.parentId
            ? titleOf(todo.parentId)
            : undefined
        }
        subtaskProgress={
          subtasks.length > 0
            ? {
                done: subtasks.filter((t) => t.isCompleted).length,
                total: subtasks.length,
              }
            : undefined
        }
        onUpdate={(changes, errorMessage) =>
          handleUpdate(todo, changes, errorMessage)
        }
        onAddSubtask={
          todo.parentId === null
            ? () => {
                setView("all");
                setSubtaskParentId(todo.id);
              }
            : undefined
        }
        onPromote={
          todo.parentId !== null
            ? () =>
                handleUpdate(todo, { parentId: null }, "格上げに失敗しました。")
            : undefined
        }
        onDelete={() => handleDelete(todo)}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-white/10">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-white">
            My TODO App
          </h1>
          <div className="flex items-center gap-4">
            <span className="hidden truncate text-sm text-neutral-400 sm:inline">
              {email ?? " "}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-neutral-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSigningOut ? "ログアウト中..." : "ログアウト"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10">
        <div className="rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl shadow-black/40 sm:p-8">
          <AddTodoForm
            placeholder="新しい TODO を入力"
            onAdd={(todo) => handleAdd(todo)}
          />

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          )}

          <div
            role="tablist"
            aria-label="表示の切り替え"
            className="mt-6 flex gap-1 rounded-lg border border-white/10 bg-neutral-950 p-1"
          >
            {VIEWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition sm:text-sm ${
                  view === id
                    ? "bg-indigo-500 text-white"
                    : "text-neutral-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {label}
                <span className="ml-1 opacity-70">({viewCounts[id]})</span>
              </button>
            ))}
          </div>

          {view === "all" ? (
            <ul className="mt-3 space-y-2">
              {parents.map((parent) => {
                const subtasks = subtasksOf(parent.id);
                return (
                  <li key={parent.id}>
                    {renderRow(parent, parents)}
                    {(subtasks.length > 0 || subtaskParentId === parent.id) && (
                      <ul className="ml-6 mt-2 space-y-2 border-l border-white/10 pl-3">
                        {subtasks.map((subtask) => (
                          <li key={subtask.id}>
                            {renderRow(subtask, subtasks)}
                          </li>
                        ))}
                        {subtaskParentId === parent.id && (
                          <li className="rounded-lg border border-indigo-500/30 bg-neutral-950 p-3">
                            <AddTodoForm
                              placeholder={`「${parent.title}」のサブタスクを入力`}
                              initialPriority={parent.priority}
                              autoFocus
                              onAdd={(todo) => handleAdd(todo, parent.id)}
                              onCancel={() => setSubtaskParentId(null)}
                            />
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="mt-3 space-y-2">
              {filteredTodos.map((todo) => (
                <li key={todo.id}>{renderRow(todo, null)}</li>
              ))}
            </ul>
          )}

          {!isLoading &&
            (view === "all" ? todos : filteredTodos).length === 0 && (
              <p className="mt-6 text-center text-sm text-neutral-500">
                {todos.length === 0
                  ? "TODO はまだありません。"
                  : view === "due"
                    ? "今日までが期限の TODO はありません。"
                    : "未完了の TODO はありません。"}
              </p>
            )}
        </div>
      </main>
    </div>
  );
}
