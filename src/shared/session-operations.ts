import type { SessionRecord } from "./session-state.ts";

export function getOperationGeneration(session: SessionRecord): number {
	return session.operationGeneration;
}

export function invalidateOperations(session: SessionRecord): void {
	session.operationGeneration += 1;
}

export function isCurrentOperation(
	session: SessionRecord,
	generation: number,
): boolean {
	return session.operationGeneration === generation;
}

export function enqueueSessionOperation<T>(
	session: SessionRecord,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = session.operationQueue.catch(() => undefined);
	const current = previous.then(operation);
	session.operationQueue = current.then(
		() => undefined,
		() => undefined,
	);
	return current;
}
