import { describe, expect, it } from "vitest";
import {
	isEmptyString,
	requireBoolean,
	requireNonEmptyString,
	requireRecord,
	requireString,
} from "../../src/shared/validation.ts";

describe("shared validation", () => {
	it("detects empty strings", () => {
		expect(isEmptyString("")).toBe(true);
		expect(isEmptyString("value")).toBe(false);
	});

	it("preserves required value validation and error messages", () => {
		expect(requireRecord({ value: 1 }, "record")).toEqual({ value: 1 });
		expect(requireString("value", "string")).toBe("value");
		expect(requireNonEmptyString("value", "nonEmpty")).toBe("value");
		expect(requireBoolean(true, "boolean")).toBe(true);
		expect(() => requireRecord(null, "record")).toThrow(
			"record must not be null",
		);
		expect(() => requireRecord([], "record")).toThrow(
			"record must not be an array",
		);
		expect(() => requireString(1, "string")).toThrow("string must be a string");
		expect(() => requireNonEmptyString("", "nonEmpty")).toThrow(
			"nonEmpty must not be empty",
		);
		expect(() => requireBoolean("true", "boolean")).toThrow(
			"boolean must be a boolean",
		);
	});
});
