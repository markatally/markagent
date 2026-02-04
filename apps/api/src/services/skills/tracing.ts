import { randomUUID } from 'crypto';

export interface TraceContext {
  traceId: string;
  parentExecutionId?: string;
  sessionId?: string;
  userId?: string;
}

export function createTraceContext(parent?: TraceContext): TraceContext {
  return {
    traceId: parent?.traceId || randomUUID(),
    parentExecutionId: parent?.parentExecutionId,
    sessionId: parent?.sessionId,
    userId: parent?.userId,
  };
}

export function childTrace(parent: TraceContext, executionId: string): TraceContext {
  return { ...parent, parentExecutionId: executionId };
}
