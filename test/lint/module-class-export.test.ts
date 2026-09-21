import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-module-class-export-";
const RULE_ID = "module-class-export";
const COMPILER_OPTIONS: ts.CompilerOptions = {
	strict: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	noEmit: true,
};

async function lintModule(
	moduleSource: string,
	consumerSource = "export class PrConsumer { constructor(options: unknown) {} }\n",
): Promise<ReturnType<typeof lintProgram>> {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const directory = join(root, "src", "pr");
	await mkdir(directory, { recursive: true });
	const modulePath = join(directory, "module.ts");
	await Promise.all([
		writeFile(modulePath, moduleSource),
		writeFile(join(directory, "event-consumers.ts"), consumerSource),
	]);
	const program = ts.createProgram([modulePath], COMPILER_OPTIONS);
	return lintProgram(program);
}

function ruleDiagnostics(diagnostics: ReturnType<typeof lintProgram>) {
	return diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
}

describe(RULE_ID, () => {
	it("allows one module class that constructs imported consumer class", async () => {
		const diagnostics = await lintModule(`
import { PrConsumer } from "./event-consumers.ts";
export class PrModule {
	private readonly consumer: PrConsumer;
	constructor(options: unknown) {
		this.consumer = new PrConsumer(options);
	}
}
`);

		expect(ruleDiagnostics(diagnostics)).toEqual([]);
	});

	it("rejects extra exports and wrong module class name", async () => {
		const diagnostics = await lintModule(`
import { PrConsumer } from "./event-consumers.ts";
export type PrOptions = unknown;
export function createPrModule(): PrModule { return new PrModule(); }
export class NotModule {
	constructor() { new PrConsumer(undefined); }
}
`);

		expect(ruleDiagnostics(diagnostics).map(({ message }) => message)).toEqual([
			"module.ts must export only PrModule class",
			"module.ts must export only PrModule class",
			"module.ts must export only PrModule class",
		]);
	});

	it("requires imported consumer class", async () => {
		const diagnostics = await lintModule(
			`export class PrModule {
		constructor() {}
}
`,
			"export function createPrConsumer(): void {}\n",
		);

		expect(ruleDiagnostics(diagnostics).map(({ message }) => message)).toEqual([
			"PrModule must import consumer class from event-consumers.ts",
		]);
	});

	it("requires module class to construct imported consumer", async () => {
		const diagnostics = await lintModule(`
import { PrConsumer } from "./event-consumers.ts";
export class PrModule {
	constructor() {}
}
`);

		expect(ruleDiagnostics(diagnostics).map(({ message }) => message)).toEqual([
			"PrModule must construct imported consumer class",
		]);
	});
});
