import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PRIORITY, isPriority, type Priority } from "@/lib/priority";
import { parseDueDate, TODO_ORDER, toTodoDTO } from "@/lib/todos";

export type TodoDTO = {
  id: string;
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
  priority?: Priority;
  dueDate?: string | null;
};
export type CreateTodoResponse = { todo: TodoDTO };
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

  // New TODOs go to the bottom of their priority group.
  const todo = await prisma.$transaction(async (tx) => {
    const { _max } = await tx.todo.aggregate({
      where: { userId: user.id, priority },
      _max: { position: true },
    });
    return tx.todo.create({
      data: {
        userId: user.id,
        title,
        priority,
        dueDate,
        position: (_max.position ?? 0) + 1,
      },
    });
  });

  return NextResponse.json<CreateTodoResponse>(
    { todo: toTodoDTO(todo) },
    { status: 201 },
  );
}
