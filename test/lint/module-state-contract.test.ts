import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { lintProgram } from "../../src/lint/index.ts";

const TEMP_PREFIX = "pi-todo-gate-module-state-contract-";
const RULE_ID = "module-state-contract";

async function lintModuleStateSource(source: string) {
	const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
	const moduleDirectory = join(root, "src", "pr");
	await mkdir(moduleDirectory, { recursive: true });
	const filePath = join(moduleDirectory, "module-state.ts");
	await writeFile(filePath, source);
	const program = ts.createProgram([filePath], {
		strict: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
	});
	return lintProgram(program);
}

describe(RULE_ID, () => {
	it("allows serializable state and descriptor methods", async () => {
		const diagnostics = await lintModuleStateSource(`
interface GoodState {
	url?: string;
	tags: string[];
	metadata: { visible: boolean; count: number | null };
}
export interface PrModuleState extends GoodState {}

declare const descriptor: {
	restore(value: unknown): PrModuleState;
	serialize(state: PrModuleState): unknown;
};
void descriptor;
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});

	it("rejects runtime-only fields and class declarations", async () => {
		const diagnostics = await lintModuleStateSource(`
interface BadState {
	callback: () => void;
	pending: Promise<void>;
	seen: Set<string>;
	handle: RuntimeHandle;
}
class RuntimeHandle {}
export interface PrModuleState extends BadState {}
`);

		const findings = diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
		expect(findings).toHaveLength(5);
		expect(findings.map(({ line }) => line)).toEqual([3, 4, 5, 6, 8]);
	});

	it("follows aliases, unions, arrays, and index signatures", async () => {
		const diagnostics = await lintModuleStateSource(`
type Nested = { value: Date };
type Values = Array<Nested>;
export interface PrModuleState {
	values: Values;
	lookup: { [key: string]: Set<string> };
	maybe: string | Promise<void>;
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			3,
		);
	});

	it("accepts literal values and readonly arrays", async () => {
		const diagnostics = await lintModuleStateSource(`
export interface PrModuleState {
	status: "pending";
	count: 1 | 2;
	flags: true | false;
	tags: readonly string[];
}
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toEqual([]);
	});

	it("rejects timer values", async () => {
		const diagnostics = await lintModuleStateSource(`
export interface PrModuleState {
	timer: Timer;
}
`);

		const findings = diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.line).toBe(3);
	});

	it("checks state types referenced by descriptors", async () => {
		const diagnostics = await lintModuleStateSource(`
interface PublicData {
	value: Date;
}
declare const descriptor: ModuleStateDescriptor<"pr", PublicData>;
void descriptor;
`);

		expect(diagnostics.filter(({ ruleId }) => ruleId === RULE_ID)).toHaveLength(
			1,
		);
	});

	it("checks inline descriptor state types", async () => {
		const diagnostics = await lintModuleStateSource(`
class RuntimeHandle {}
declare const descriptor: ModuleStateDescriptor<
	"pr",
	{ date: Date; callback: () => void; handle: RuntimeHandle; worker: Worker }
>;
void descriptor;
`);

		const findings = diagnostics.filter(({ ruleId }) => ruleId === RULE_ID);
		expect(findings).toHaveLength(5);
		expect(findings.map(({ line }) => line)).toEqual([2, 5, 5, 5, 5]);
	});

	it("does not inspect files outside module-state.ts", async () => {
		const root = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		const filePath = join(root, "src", "pr", "internal-state.ts");
		await mkdir(join(root, "src", "pr"), { recursive: true });
		await writeFile(
			filePath,
			"export interface RuntimeState { callback: () => void }",
		);
		const program = ts.createProgram([filePath], {
			strict: true,
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			noEmit: true,
		});

		expect(
			lintProgram(program).filter(({ ruleId }) => ruleId === RULE_ID),
		).toEqual([]);
	});
});
