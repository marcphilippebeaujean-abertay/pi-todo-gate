import type { ActiveSession } from "./extension-types.ts";

export function getOperationGeneration(session: ActiveSession): number {
	return session.operationGeneration;
}

export function invalidateOperations(session: ActiveSession): void {
	session.operationGeneration += 1;
}

export function isCurrentOperation(
	session: ActiveSession,
	generation: number,
): boolean {
	return session.operationGeneration === generation;
}

export function enqueueSessionOperation<T>(
	session: ActiveSession,
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
