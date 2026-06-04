/// <reference lib="webworker" />

import { generateRenderGrid } from "../processing/renderGrid";
import type { WorkerRequest, WorkerResponse } from "../renderer/types";

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, imageData, options } = event.data;

  const response: WorkerResponse = {
    id,
    grid: generateRenderGrid(imageData, options)
  };

  ctx.postMessage(response);
};

export {};
