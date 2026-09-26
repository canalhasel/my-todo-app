import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { isPriority, type Priority } from "@/lib/priority";
import {
  listTodos,
  nextPosition,
  parseDueDate,
  syncParentCompletion,
  toTodoDTO,
} from "@/lib/todos";
import type { ApiErrorResponse, TodoDTO } from "@/app/api/todos/route";

export type UpdateTodoRequestBody = {
  /** On a parent, its subtasks follow; on a subtask, the parent is re-synced. */
  isCompleted?: boolean;
  priority?: Priority;
  /** "YYYY-MM-DD", or null to clear the due date. */
  dueDate?: string | null;
  /** null promotes a subtask to a top-level TODO. */
  parentId?: null;
};
/** Completion cascades between parent and subtasks, so the whole list comes back. */
export type UpdateTodoResponse = { todos: TodoDTO[] };
export type DeleteTodoResponse = { todos: TodoDTO[] };

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

  if (body.parentId !== undefined && body.parentId !== null) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "parentId は null（格上げ）のみ指定できます。" },
      { status: 400 },
    );
  }

  const todos = await prisma.$transaction(async (tx) => {
    const existing = await tx.todo.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return null;

    const priority = body.priority ?? existing.priority;
    const isPromoting = body.parentId === null && existing.parentId !== null;
    const parentId = isPromoting ? null : existing.parentId;

    // Joining another sibling group (new priority, or promoted to the top
    // level) puts the TODO at the bottom of that group.
    const position =
      priority !== existing.priority || isPromoting
        ? await nextPosition(tx, { userId: user.id, parentId, priority })
        : undefined;

    await tx.todo.update({
      where: { id },
      data: {
        isCompleted: body.isCompleted,
        priority: body.priority,
        position,
        dueDate,
        parentId: isPromoting ? null : undefined,
      },
    });

    if (body.isCompleted !== undefined && existing.parentId === null) {
      // Checking or unchecking a parent does the same to all its subtasks.
      await tx.todo.updateMany({
        where: { parentId: id },
        data: { isCompleted: body.isCompleted },
      });
    }

    // The old parent gained or lost an unfinished subtask.
    if (existing.parentId && (body.isCompleted !== undefined || isPromoting)) {
      await syncParentCompletion(tx, existing.parentId);
    }

    return listTodos(tx, user.id);
  });

  if (!todos) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "TODO が見つかりません。" },
      { status: 404 },
    );
  }

  return NextResponse.json<UpdateTodoResponse>({ todos: todos.map(toTodoDTO) });
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

  const todos = await prisma.$transaction(async (tx) => {
    const existing = await tx.todo.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) return null;

    // Subtasks go with their parent (ON DELETE CASCADE).
    await tx.todo.delete({ where: { id } });

    // Removing an unfinished subtask may leave the rest all done.
    if (existing.parentId) {
      await syncParentCompletion(tx, existing.parentId);
    }

    return listTodos(tx, user.id);
  });

  if (!todos) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "TODO が見つかりません。" },
      { status: 404 },
    );
  }

  return NextResponse.json<DeleteTodoResponse>({ todos: todos.map(toTodoDTO) });
}
