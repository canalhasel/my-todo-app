import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { listTodos, TODO_ORDER, toTodoDTO } from "@/lib/todos";
import type { ApiErrorResponse, TodoDTO } from "@/app/api/todos/route";

/**
 * Swaps the TODO with its neighbour among siblings (same parent) sharing its
 * priority and due date — the only ones the list order leaves to the user.
 */
export type MoveTodoRequestBody = { direction: "up" | "down" };
/** Moving one TODO renumbers others, so the whole list comes back. */
export type MoveTodoResponse = { todos: TodoDTO[] };

export async function PUT(
  request: NextRequest,
  ctx: RouteContext<"/api/todos/[id]/position">,
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
  const body = (await request.json()) as MoveTodoRequestBody;

  if (body.direction !== "up" && body.direction !== "down") {
    return NextResponse.json<ApiErrorResponse>(
      { error: "direction は up か down で指定してください。" },
      { status: 400 },
    );
  }

  const todos = await prisma.$transaction(async (tx) => {
    const target = await tx.todo.findFirst({
      where: { id, userId: user.id },
    });
    if (!target) return null;

    const group = await tx.todo.findMany({
      where: {
        userId: user.id,
        parentId: target.parentId,
        priority: target.priority,
        dueDate: target.dueDate,
      },
      orderBy: TODO_ORDER,
    });

    const from = group.findIndex((todo) => todo.id === id);
    const to = body.direction === "up" ? from - 1 : from + 1;

    // Already at the edge of its group: nothing to do.
    if (to >= 0 && to < group.length) {
      [group[from], group[to]] = [group[to], group[from]];

      // Renumber 1..n so duplicate or gapped positions can't stall a swap.
      // Sequential: an interactive transaction runs on a single connection.
      for (const [index, todo] of group.entries()) {
        if (todo.position === index + 1) continue;
        await tx.todo.update({
          where: { id: todo.id },
          data: { position: index + 1 },
        });
      }
    }

    return listTodos(tx, user.id);
  });

  if (!todos) {
    return NextResponse.json<ApiErrorResponse>(
      { error: "TODO が見つかりません。" },
      { status: 404 },
    );
  }

  return NextResponse.json<MoveTodoResponse>({ todos: todos.map(toTodoDTO) });
}
