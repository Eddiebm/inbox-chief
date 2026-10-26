import { NextResponse } from "next/server";
import { taskIsStale, whatHappened } from "@/lib/research/policy";
import { requireResearchScope } from "@/lib/research/http";
import { createResearchDeps, researchStore } from "@/lib/research/runtime";
import { resumeResearchTask } from "@/lib/research/turn";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const task = await researchStore().getTask(auth.scope, id);
  if (!task) return NextResponse.json({ ok: false, spoken: "I cannot find that task in your account." }, { status: 404 });
  const interrupted = task.status === "RUNNING" && taskIsStale(task.heartbeatAt, new Date());
  return NextResponse.json({
    ok: true,
    task,
    interrupted,
    spoken: interrupted ? whatHappened("task_interrupted").spoken : `The task is ${task.status.toLowerCase()}, on step ${task.step}.`,
  });
}

export async function POST(_request: Request, { params }: Params) {
  const auth = await requireResearchScope();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const result = await resumeResearchTask({ scope: auth.scope, taskId: id, deps: createResearchDeps(auth.scope) });
  return NextResponse.json(result);
}
