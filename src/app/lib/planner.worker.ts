/**
 * The planner, off the render thread.
 *
 * Deliberately a few lines of plumbing: every decision lives in `planner-protocol.ts`, where a test
 * can reach it without a worker at all.
 */
import { createPlanner, type PlannerRequest } from './planner-protocol.ts';

const planner = createPlanner();

/**
 * The drop analysis, one bar per task: each bar is posted as it is measured, and a newer request
 * queued behind it is read before the next bar — then `analysisStep` declines the superseded plan.
 */
const pump = (id: number): void => {
  setTimeout(() => {
    const answer = planner.analysisStep(id);
    if (!answer) return;
    self.postMessage(answer);
    if (!answer.done) pump(id);
  }, 0);
};

self.onmessage = (event: MessageEvent<PlannerRequest>): void => {
  const response = planner.handle(event.data);
  if (!response) return;
  self.postMessage(response);
  // The analysis goes on tasks of its own, so a newer request already queued behind this one is read
  // first — and then `analysisStep` declines to answer a superseded plan.
  if (response.type === 'plan' && response.analysisPending) pump(response.id);
};
