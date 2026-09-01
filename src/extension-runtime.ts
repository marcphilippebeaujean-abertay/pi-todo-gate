import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	ExtensionDependencies,
	ExtensionRuntime,
} from "./extension-types.ts";

export function createExtensionRuntime(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies,
): ExtensionRuntime {
	return { pi, dependencies, active: null, registered: false };
}
