/**
 * The planner, off the render thread.
 *
 * Deliberately a few lines of plumbing: every decision lives in `planner-protocol.ts`, where a test
 * can reach it without a worker at all.
 */
import { createPlanner, type PlannerRequest } from './planner-protocol.ts';

const planner = createPlanner();

self.onmessage = (event: MessageEvent<PlannerRequest>): void => {
  const response = planner.handle(event.data);
  if (!response) return;
  self.postMessage(response);
  // The drop analysis goes on a task of their own, so a newer request already queued behind this one is
  // read first — and then `alternatives` declines to answer a superseded plan.
  if (response.type === 'plan' && response.analysisPending) {
    const id = response.id;
    setTimeout(() => {
      const analysis = planner.alternatives(id);
      if (analysis) self.postMessage(analysis);
    }, 0);
  }
};
