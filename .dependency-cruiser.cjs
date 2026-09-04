module.exports = {
	forbidden: [
		{
			name: "no-pr-to-todoist",
			severity: "error",
			from: { path: "^src/pr/" },
			to: { path: "^src/todoist/" },
		},
		{
			name: "no-pr-to-herdr",
			severity: "error",
			from: { path: "^src/pr/" },
			to: { path: "^src/herdr/" },
		},
		{
			name: "no-todoist-to-pr",
			severity: "error",
			from: { path: "^src/todoist/" },
			to: { path: "^src/pr/" },
		},
		{
			name: "no-todoist-to-herdr",
			severity: "error",
			from: { path: "^src/todoist/" },
			to: { path: "^src/herdr/" },
		},
		{
			name: "no-herdr-to-pr",
			severity: "error",
			from: { path: "^src/herdr/" },
			to: { path: "^src/pr/" },
		},
		{
			name: "no-herdr-to-todoist",
			severity: "error",
			from: { path: "^src/herdr/" },
			to: { path: "^src/todoist/" },
		},
		{
			name: "no-shared-to-pr",
			severity: "error",
			from: { path: "^src/shared/" },
			to: { path: "^src/pr/" },
		},
		{
			name: "no-shared-to-todoist",
			severity: "error",
			from: { path: "^src/shared/" },
			to: { path: "^src/todoist/" },
		},
		{
			name: "no-shared-to-herdr",
			severity: "error",
			from: { path: "^src/shared/" },
			to: { path: "^src/herdr/" },
		},
		{
			name: "no-pr-test-to-todoist",
			severity: "error",
			from: { path: "^test/pr/" },
			to: { path: "^src/todoist/" },
		},
		{
			name: "no-pr-test-to-herdr",
			severity: "error",
			from: { path: "^test/pr/" },
			to: { path: "^src/herdr/" },
		},
		{
			name: "no-todoist-test-to-pr",
			severity: "error",
			from: { path: "^test/todoist/" },
			to: { path: "^src/pr/" },
		},
		{
			name: "no-todoist-test-to-herdr",
			severity: "error",
			from: { path: "^test/todoist/" },
			to: { path: "^src/herdr/" },
		},
		{
			name: "no-herdr-test-to-pr",
			severity: "error",
			from: { path: "^test/herdr/" },
			to: { path: "^src/pr/" },
		},
		{
			name: "no-herdr-test-to-todoist",
			severity: "error",
			from: { path: "^test/herdr/" },
			to: { path: "^src/todoist/" },
		},
		{
			name: "no-orphans",
			severity: "error",
			from: { orphan: true, path: "^src/" },
			to: {},
		},
	],
	options: {
		tsPreCompilationDeps: true,
		doNotFollow: { path: "node_modules" },
		enhancedResolveOptions: {
			extensions: [".ts", ".js", ".json"],
		},
	},
};
