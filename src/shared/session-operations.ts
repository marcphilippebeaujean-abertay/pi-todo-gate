import type { SessionContext } from "../state.ts";

export function getOperationGeneration(session: SessionContext): number {
	return session.operationGeneration;
}

export function invalidateOperations(session: SessionContext): void {
	session.operationGeneration += 1;
}

export function isCurrentOperation(
	session: SessionContext,
	generation: number,
): boolean {
	return session.operationGeneration === generation;
}

export function enqueueSessionOperation<T>(
	session: SessionContext,
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
