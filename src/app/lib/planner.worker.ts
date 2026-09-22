/**
 * The planner, off the render thread.
 *
 * Deliberately four lines of plumbing: every decision lives in `planner-protocol.ts`, where a test
 * can reach it without a worker at all.
 */
import { createPlanner, type PlannerRequest } from './planner-protocol.ts';

const planner = createPlanner();

self.onmessage = (event: MessageEvent<PlannerRequest>): void => {
  const response = planner.handle(event.data);
  if (response) self.postMessage(response);
};
