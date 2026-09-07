import { describe, expect, it } from "vitest";
import { lintFixture, ruleIds } from "./helpers.ts";

const RULE = "prefer-switch-dispatch";
const REPEATED = `function dispatch(action: string) { if (action === "status") return 1; if (action === "set_pr") return 2; return 0; }`;
describe(RULE, () => {
	it("prefers switch for adjacent equality dispatch", async () => {
		expect(ruleIds(await lintFixture(REPEATED))).toContain(RULE);
		expect(
			ruleIds(
				await lintFixture(
					`function dispatch(action: string) { if (action === C.action.status) return 1; if (action === C.action.setPr) return 2; return 0; }`,
				),
			),
		).toContain(RULE);
		expect(
			ruleIds(
				await lintFixture(
					`function dispatch(action: string) { if (action === "status") return 1; const isSetPr = action === "set_pr"; if (action === "set_pr") return 2; return 0; }`,
				),
			),
		).toContain(RULE);
		expect(
			ruleIds(
				await lintFixture(
					`function dispatch(action: string) { const isStatus = action === "status"; if (isStatus) return 1; const isSetPr = action === "set_pr"; if (isSetPr) return 2; return 0; }`,
				),
			),
		).toContain(RULE);
		expect(
			ruleIds(
				await lintFixture(
					`function dispatch(action: string) { if (action === "status") return 1; const isReady = true; if (action === "set_pr") return 2; return isReady ? 0 : 3; }`,
				),
			),
		).not.toContain(RULE);
	});
	it("does not skip a dispatch after a nonmatching statement", async () => {
		const diagnostics = (
			await lintFixture(
				`function dispatch(action: string, other: string) { if (action === "status") return 1; if (other === "one") return 2; if (other === "two") return 3; return 0; }`,
			)
		).filter(({ ruleId }) => ruleId === RULE);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]?.value).toBe(2);
	});
});
