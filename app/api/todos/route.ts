import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export type TodoDTO = {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: string;
};

export type GetTodosResponse = { todos: TodoDTO[] };
export type CreateTodoRequestBody = { title: string };
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
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json<GetTodosResponse>({
    todos: todos.map((todo) => ({
      id: todo.id,
      title: todo.title,
      isCompleted: todo.isCompleted,
      createdAt: todo.createdAt.toISOString(),
    })),
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

  const todo = await prisma.todo.create({
    data: { userId: user.id, title },
  });

  return NextResponse.json<CreateTodoResponse>(
    {
      todo: {
        id: todo.id,
        title: todo.title,
        isCompleted: todo.isCompleted,
        createdAt: todo.createdAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
