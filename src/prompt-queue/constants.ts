import { fileURLToPath } from "node:url";

export const mergeProtocolSkillPath = fileURLToPath(
	new URL("../../skills/merge-protocol", import.meta.url),
);
