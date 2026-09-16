"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
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

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const [todos, setTodos] = useState<TodoDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

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
        body: JSON.stringify({ title: trimmed } satisfies CreateTodoRequestBody),
      });

      if (!res.ok) throw new Error();

      const data = (await res.json()) as CreateTodoResponse;
      setTodos((prev) => [...prev, data.todo]);
      setTitle("");
    } catch {
      setError("TODO の追加に失敗しました。");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleToggle(todo: TodoDTO) {
    setPendingIds((prev) => new Set(prev).add(todo.id));
    setError(null);

    const nextIsCompleted = !todo.isCompleted;
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todo.id ? { ...t, isCompleted: nextIsCompleted } : t,
      ),
    );

    try {
      const res = await fetch(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isCompleted: nextIsCompleted,
        } satisfies UpdateTodoRequestBody),
      });

      if (!res.ok) throw new Error();

      const data = (await res.json()) as UpdateTodoResponse;
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? data.todo : t)),
      );
    } catch {
      setTodos((prev) =>
        prev.map((t) =>
          t.id === todo.id ? { ...t, isCompleted: todo.isCompleted } : t,
        ),
      );
      setError("更新に失敗しました。");
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(todo.id);
        return next;
      });
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
          <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="新しい TODO を入力"
              className="w-full rounded-lg border border-white/10 bg-neutral-950 px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              type="submit"
              disabled={isAdding || !title.trim()}
              className="shrink-0 rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAdding ? "追加中..." : "追加"}
            </button>
          </form>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          )}

          <ul className="mt-6 space-y-2">
            {todos.map((todo) => {
              const isPending = pendingIds.has(todo.id);
              return (
                <li
                  key={todo.id}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-neutral-950 px-4 py-3"
                >
                  <input
                    type="checkbox"
                    checked={todo.isCompleted}
                    onChange={() => handleToggle(todo)}
                    disabled={isPending}
                    className="size-4 shrink-0 rounded border-white/20 bg-neutral-900 accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      todo.isCompleted
                        ? "text-neutral-500 line-through"
                        : "text-white"
                    }`}
                  >
                    {todo.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(todo.id)}
                    disabled={isPending}
                    className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-neutral-400 transition hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    削除
                  </button>
                </li>
              );
            })}
          </ul>

          {!isLoading && todos.length === 0 && (
            <p className="mt-6 text-center text-sm text-neutral-500">
              TODO はまだありません。
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
