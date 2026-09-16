import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { ApiErrorResponse, TodoDTO } from "@/app/api/todos/route";

export type UpdateTodoRequestBody = { isCompleted: boolean };
export type UpdateTodoResponse = { todo: TodoDTO };
export type DeleteTodoResponse = { success: true };

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/todos/[id]">,
) {
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

  const { id } = await ctx.params;
  const body = (await request.json()) as UpdateTodoRequestBody;

  const { count } = await prisma.todo.updateMany({
    where: { id, userId: user.id },
    data: { isCompleted: body.isCompleted },
  });

  if (count === 0) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "TODO が見つかりません。" },
      { status: 404 },
    );
  }

  const todo = await prisma.todo.findFirstOrThrow({
    where: { id, userId: user.id },
  });

  return NextResponse.json<UpdateTodoResponse>({
    todo: {
      id: todo.id,
      title: todo.title,
      isCompleted: todo.isCompleted,
      createdAt: todo.createdAt.toISOString(),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/todos/[id]">,
) {
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

  const { id } = await ctx.params;

  const { count } = await prisma.todo.deleteMany({
    where: { id, userId: user.id },
  });

  if (count === 0) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "TODO が見つかりません。" },
      { status: 404 },
    );
  }

  return NextResponse.json<DeleteTodoResponse>({ success: true });
}
