import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-event-types-outside-events-";
const RULE_ID = "event-types-outside-events";
const COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
};

async function lintModule(
	fileName: string,
	source: string,
): Promise<ReturnType<typeof lintProgram>> {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src", "pr");
	await mkdir(directory, { recursive: true });
	const filePath = join(directory, fileName);
	await Promise.all([
		writeFile(
			join(directory, "events.ts"),
			"export interface EventPayload { value: string; }\n",
		),
		writeFile(
			join(directory, "state.ts"),
			"export interface StatePayload { value: string; }\n",
		),
		writeFile(filePath, source),
	]);
	const program = ts.createProgram([filePath], COMPILER_OPTIONS);
	return lintProgram(program);
}

function ruleDiagnostics(
	diagnostics: ReturnType<typeof lintProgram>,
): ReturnType<typeof lintProgram> {
	return diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
}

describe(RULE_ID, () => {
	it("rejects state types on callbacks passed to event consumers", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`import type { StatePayload } from "./state.ts";
declare const events: {
	on(
		name: string,
		listener: (payload: StatePayload) => void,
		phase?: string,
	): void;
};
events.on("event", (payload: StatePayload) => {}, "collect");
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("rejects inline event callback types", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`declare const events: {
	on(name: string, listener: (payload: { value: string }) => void): void;
};
events.on("event", (payload: { value: string }) => {});
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("checks named event-consumer callbacks", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`import type { StatePayload } from "./state.ts";
declare const events: {
	on(name: string, listener: (payload: StatePayload) => void): void;
};
const onEvent = (payload: StatePayload): void => {};
events.on("event", onEvent);
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("checks bound event-consumer methods", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`import type { StatePayload } from "./state.ts";
declare const events: {
	on(
		name: string,
		listener: (payload: StatePayload) => void,
		phase?: string,
	): void;
};
class Consumer {
	private onEvent(payload: StatePayload): void {}
	start(): void { events.on("event", this.onEvent.bind(this), "collect"); }
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("ignores types for parameters pre-bound before event registration", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`import type { EventPayload } from "./events.ts";
import type { StatePayload } from "./state.ts";
declare const events: {
	on(name: string, listener: (payload: EventPayload) => void): void;
};
class Consumer {
	private onEvent(runtime: StatePayload, payload: EventPayload): void {}
	start(runtime: StatePayload): void {
		events.on("event", this.onEvent.bind(this, runtime));
	}
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("allows private event-consumer utilities", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`import type { StatePayload } from "./state.ts";
function isCurrent(payload: StatePayload): boolean { return payload.value.length > 0; }
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("rejects state types on exported event publishers", async () => {
		const diagnostics = await lintModule(
			"event-publishers.ts",
			`import type { StatePayload } from "./state.ts";
declare const events: { emit(name: string, payload: StatePayload): void };
export function publish(payload: StatePayload): void { events.emit("event", payload); }
`,
		);

		expect(ruleDiagnostics(diagnostics)).toHaveLength(1);
	});

	it("allows event types on event publishers", async () => {
		const diagnostics = await lintModule(
			"event-publishers.ts",
			`import type { EventPayload } from "./events.ts";
declare const events: { emit(name: string, payload: EventPayload): void };
export function publish(payload: EventPayload): void { events.emit("event", payload); }
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("does not restrict constructor parameter types", async () => {
		const diagnostics = await lintModule(
			"event-consumers.ts",
			`import type { StatePayload } from "./state.ts";
class Consumer {
	constructor(state: StatePayload) {}
}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("does not apply to non-event files", async () => {
		const diagnostics = await lintModule(
			"commands.ts",
			`import type { StatePayload } from "./state.ts";
export function command(state: StatePayload): void {}
`,
		);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});
});
