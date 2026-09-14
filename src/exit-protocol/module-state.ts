import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

export interface ExitProtocolModuleState {
	active: boolean;
}

export const exitProtocolStateDescriptor: ModuleStateDescriptor<
	"exitProtocol",
	ExitProtocolModuleState
> = {
	id: "exitProtocol",
	createInitialState: () => ({ active: false }),
	restore: (value) => {
		const isObjectValue = typeof value === "object" && value !== null;
		const isArrayValue = Array.isArray(value);
		const isInvalidValue = !isObjectValue || isArrayValue;
		if (isInvalidValue) return { active: false };
		const active = (value as { active?: unknown }).active;
		const hasValidActive = typeof active === "boolean";
		return hasValidActive ? { active } : { active: false };
	},
	serialize: (state): JsonValue => ({ active: state.active }),
};
