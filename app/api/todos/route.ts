import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PRIORITY, isPriority, type Priority } from "@/lib/priority";
import {
  listTodos,
  nextPosition,
  parseDueDate,
  syncParentCompletion,
  TODO_ORDER,
  toTodoDTO,
} from "@/lib/todos";

export type TodoDTO = {
  id: string;
  /** The parent TODO's id for a subtask, or null for a top-level TODO. */
  parentId: string | null;
  title: string;
  isCompleted: boolean;
  priority: Priority;
  position: number;
  /** "YYYY-MM-DD", or null when no due date is set. */
  dueDate: string | null;
  createdAt: string;
};

export type GetTodosResponse = { todos: TodoDTO[] };
export type CreateTodoRequestBody = {
  title: string;
  /** Adds the TODO as a subtask of this top-level TODO. */
  parentId?: string | null;
  priority?: Priority;
  dueDate?: string | null;
};
/** Adding a subtask can reopen its parent, so the whole list comes back. */
export type CreateTodoResponse = { todos: TodoDTO[] };
export type ApiErrorResponse = { error: string };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "認証が必要です。" },
      { status: 401 },
    );
  }

  const todos = await prisma.todo.findMany({
    where: { userId: user.id },
    orderBy: TODO_ORDER,
  });

  return NextResponse.json<GetTodosResponse>({
    todos: todos.map(toTodoDTO),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "認証が必要です。" },
      { status: 401 },
    );
  }

  const body = (await request.json()) as CreateTodoRequestBody;
  const title = body.title?.trim();

  if (!title) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "タイトルを入力してください。" },
      { status: 400 },
    );
  }

  const priority = body.priority ?? DEFAULT_PRIORITY;
  if (!isPriority(priority)) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "優先度は S / A / B / C のいずれかです。" },
      { status: 400 },
    );
  }

  const dueDate = parseDueDate(body.dueDate ?? null);
  if (dueDate === undefined) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "期限日の形式が正しくありません。" },
      { status: 400 },
    );
  }

  const parentId = body.parentId ?? null;

  const todos = await prisma.$transaction(async (tx) => {
    if (parentId) {
      const parent = await tx.todo.findFirst({
        where: { id: parentId, userId: user.id },
      });
      // Only two levels: a subtask cannot have subtasks of its own.
      if (!parent || parent.parentId) return null;
    }

    // New TODOs go to the bottom of their sibling group.
    await tx.todo.create({
      data: {
        userId: user.id,
        parentId,
        title,
        priority,
        dueDate,
        position: await nextPosition(tx, {
          userId: user.id,
          parentId,
          priority,
        }),
      },
    });
    // A new, unfinished subtask reopens a completed parent.
    if (parentId) await syncParentCompletion(tx, parentId);

    return listTodos(tx, user.id);
  });

  if (!todos) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "サブタスクを追加できる親の TODO が見つかりません。" },
      { status: 400 },
    );
  }

  return NextResponse.json<CreateTodoResponse>(
    { todos: todos.map(toTodoDTO) },
    { status: 201 },
  );
}
