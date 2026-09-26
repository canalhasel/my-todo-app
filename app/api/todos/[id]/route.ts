import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isPriority, type Priority } from "@/lib/priority";
import { parseDueDate, toTodoDTO } from "@/lib/todos";
import type { ApiErrorResponse, TodoDTO } from "@/app/api/todos/route";

export type UpdateTodoRequestBody = {
  isCompleted?: boolean;
  priority?: Priority;
  /** "YYYY-MM-DD", or null to clear the due date. */
  dueDate?: string | null;
};
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

  const dueDate =
    body.dueDate === undefined ? undefined : parseDueDate(body.dueDate);
  if (body.dueDate !== undefined && dueDate === undefined) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "期限日の形式が正しくありません。" },
      { status: 400 },
    );
  }

  if (body.priority !== undefined && !isPriority(body.priority)) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "優先度は S / A / B / C のいずれかです。" },
      { status: 400 },
    );
  }

  const count = await prisma.$transaction(async (tx) => {
    const existing = await tx.todo.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return 0;

    // A TODO moved to another priority joins the bottom of that group.
    let position: number | undefined;
    if (body.priority && body.priority !== existing.priority) {
      const { _max } = await tx.todo.aggregate({
        where: { userId: user.id, priority: body.priority },
        _max: { position: true },
      });
      position = (_max.position ?? 0) + 1;
    }

    await tx.todo.update({
      where: { id },
      data: {
        isCompleted: body.isCompleted,
        priority: body.priority,
        position,
        dueDate,
      },
    });
    return 1;
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

  return NextResponse.json<UpdateTodoResponse>({ todo: toTodoDTO(todo) });
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
