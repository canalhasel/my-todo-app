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

/** ↑↓ only reorders TODOs the sort leaves tied: same priority and due date. */
function isSwappable(a: TodoDTO | undefined, b: TodoDTO | undefined) {
  return !!a && !!b && a.priority === b.priority && a.dueDate === b.dueDate;
}

/** Mirrors the server's swap so ↑↓ feel instant; the response replaces it. */
function swapWithNeighbour(
  todos: TodoDTO[],
  id: string,
  direction: MoveTodoRequestBody["direction"],
) {
  const from = todos.findIndex((t) => t.id === id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || !isSwappable(todos[from], todos[to])) {
    return todos;
  }
  const next = [...todos];
  [next[from], next[to]] = [
    { ...next[to], position: next[from].position },
    { ...next[from], position: next[to].position },
  ];
  return next;
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

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [todos, setTodos] = useState<TodoDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>(DEFAULT_PRIORITY);
  const [dueDate, setDueDate] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [isReordering, setIsReordering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("all");

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

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setIsAdding(true);
    setError(null);

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          priority,
          dueDate: dueDate || null,
        } satisfies CreateTodoRequestBody),
      });

      if (!res.ok) throw new Error();

      const data = (await res.json()) as CreateTodoResponse;
      setTodos((prev) => sortTodos([...prev, data.todo]));
      setTitle("");
      setPriority(DEFAULT_PRIORITY);
      setDueDate("");
    } catch {
      setError("TODO の追加に失敗しました。");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleUpdate(
    todo: TodoDTO,
    changes: UpdateTodoRequestBody,
    errorMessage: string,
  ) {
    setPendingIds((prev) => new Set(prev).add(todo.id));
    setError(null);
    setTodos((prev) =>
      sortTodos(prev.map((t) => (t.id === todo.id ? { ...t, ...changes } : t))),
    );

    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes satisfies UpdateTodoRequestBody),
      });

      if (!res.ok) throw new Error();

      const data = (await res.json()) as UpdateTodoResponse;
      setTodos((prev) =>
        sortTodos(prev.map((t) => (t.id === todo.id ? data.todo : t))),
      );
    } catch {
      setTodos((prev) =>
        sortTodos(prev.map((t) => (t.id === todo.id ? todo : t))),
      );
      setError(errorMessage);
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
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

  async function handleDelete(id: string) {
    setPendingIds((prev) => new Set(prev).add(id));
    setError(null);

    try {
      const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();

      (await res.json()) as DeleteTodoResponse;
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setError("削除に失敗しました。");
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const today = localDateString(new Date());
  // Both views are slices of the already sorted list.
  const viewTodos: Record<View, TodoDTO[]> = {
    all: todos,
    top: todos.filter((todo) => !todo.isCompleted).slice(0, TOP_COUNT),
    due: todos.filter((todo) => todo.dueDate !== null && todo.dueDate <= today),
  };
  const visibleTodos = viewTodos[view];

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
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="新しい TODO を入力"
              className="w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />

            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <fieldset>
                <legend className="mb-1.5 text-xs font-medium text-neutral-400">
                  優先度
                </legend>
                <div className="flex gap-1.5">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      aria-pressed={priority === p}
                      className={`size-9 rounded-lg border text-sm font-bold transition ${
                        priority === p
                          ? PRIORITY_STYLES[p]
                          : "border-white/10 text-neutral-500 hover:border-white/20 hover:text-neutral-300"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </fieldset>

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

              <button
                type="submit"
                disabled={isAdding || !title.trim()}
                className="h-9 shrink-0 rounded-lg bg-indigo-500 px-5 text-sm font-semibold text-white transition hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto"
              >
                {isAdding ? "追加中..." : "追加"}
              </button>
            </div>
          </form>

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
                <span className="ml-1 opacity-70">
                  ({viewTodos[id].length})
                </span>
              </button>
            ))}
          </div>

          <ul className="mt-3 space-y-2">
            {visibleTodos.map((todo) => {
              const isPending = pendingIds.has(todo.id);
              // Neighbours in the full list: a filtered view may hide them.
              const index = todos.indexOf(todo);
              const canMoveUp = isSwappable(todo, todos[index - 1]);
              const canMoveDown = isSwappable(todo, todos[index + 1]);
              return (
                <li
                  key={todo.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-white/10 bg-neutral-950 px-3 py-3"
                >
                  {view === "all" && (
                    <div className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        onClick={() => handleMove(todo.id, "up")}
                        disabled={isReordering || !canMoveUp}
                        aria-label="上へ（優先度・期限日が同じ TODO の中で）"
                        className="px-1 text-xs leading-4 text-neutral-400 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(todo.id, "down")}
                        disabled={isReordering || !canMoveDown}
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
                      handleUpdate(
                        todo,
                        { isCompleted: !todo.isCompleted },
                        "更新に失敗しました。",
                      )
                    }
                    disabled={isPending}
                    className="size-4 shrink-0 rounded border-white/20 bg-neutral-900 accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <select
                    value={todo.priority}
                    onChange={(event) =>
                      handleUpdate(
                        todo,
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
                      <option
                        key={p}
                        value={p}
                        className="bg-neutral-900 text-white"
                      >
                        {p}
                      </option>
                    ))}
                  </select>
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      todo.isCompleted
                        ? "text-neutral-500 line-through"
                        : "text-white"
                    }`}
                  >
                    {todo.title}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <DueDateChip
                      value={todo.dueDate}
                      today={today}
                      disabled={isPending}
                      onChange={(value) => {
                        if (value === todo.dueDate) return;
                        handleUpdate(
                          todo,
                          { dueDate: value },
                          "期限日の更新に失敗しました。",
                        );
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleDelete(todo.id)}
                      disabled={isPending}
                      className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      削除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {!isLoading && visibleTodos.length === 0 && (
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
