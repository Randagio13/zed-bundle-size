import type * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import analyzeMetafile from "./analyzeMetafile";

const makeMetafile = (
	inputs: Record<string, { bytesInOutput: number }>,
	totalBytes: number,
): esbuild.Metafile => ({
	inputs: Object.fromEntries(
		Object.keys(inputs).map((k) => [k, { imports: [], bytes: 0 }]),
	),
	outputs: {
		"<bundle>.js": {
			inputs,
			bytes: totalBytes,
			imports: [],
			exports: [],
		},
	},
});

describe("analyzeMetafile", () => {
	it("returns a markdown table with header", () => {
		const metafile = makeMetafile(
			{ "node_modules/react/index.js": { bytesInOutput: 1000 } },
			1000,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("| Input | Files | Size | Percent |");
	});

	it("includes a row for each top-level npm module", () => {
		const metafile = makeMetafile(
			{
				"node_modules/react/index.js": { bytesInOutput: 600 },
				"node_modules/lodash/lodash.js": { bytesInOutput: 400 },
			},
			1000,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("react");
		expect(result).toContain("lodash");
	});

	it("shows 100% for the output file row", () => {
		const metafile = makeMetafile(
			{ "node_modules/react/index.js": { bytesInOutput: 500 } },
			500,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("100%");
	});

	it("calculates percentage per module", () => {
		const metafile = makeMetafile(
			{
				"node_modules/react/index.js": { bytesInOutput: 500 },
				"node_modules/lodash/lodash.js": { bytesInOutput: 500 },
			},
			1000,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("50.0%");
	});

	it("skips modules that contribute zero bytes", () => {
		const metafile = makeMetafile(
			{
				"node_modules/react/index.js": { bytesInOutput: 1000 },
				"node_modules/empty/index.js": { bytesInOutput: 0 },
			},
			1000,
		);
		const result = analyzeMetafile(metafile);
		expect(result).not.toContain("empty");
	});

	it("handles scoped packages correctly", () => {
		const metafile = makeMetafile(
			{ "node_modules/@scope/pkg/index.js": { bytesInOutput: 1000 } },
			1000,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("@scope/pkg");
	});
});
