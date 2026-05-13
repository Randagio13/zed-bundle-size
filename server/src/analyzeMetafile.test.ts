import type * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import analyzeMetafile from "./analyzeMetafile";

const makeMetafile = (
	inputs: Record<string, { bytesInOutput: number }>,
	totalBytes: number,
	entryPoint?: string,
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
			entryPoint,
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

	it("renders the entry point file in the table", () => {
		const metafile = makeMetafile(
			{ "<import>": { bytesInOutput: 1000 } },
			1000,
			"<import>",
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("<import>");
	});

	it("handles relative file inputs without a parent prefix", () => {
		const metafile = makeMetafile(
			{ "src/utils.ts": { bytesInOutput: 400 } },
			400,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("src");
	});

	it("handles relative file inputs with a ../../ parent prefix", () => {
		const metafile = makeMetafile(
			{ "../../shared/utils.ts": { bytesInOutput: 400 } },
			400,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("shared");
	});

	it("lists multiple files from the same module inline", () => {
		const metafile = makeMetafile(
			{
				"node_modules/react/index.js": { bytesInOutput: 300 },
				"node_modules/react/cjs/react.production.js": { bytesInOutput: 200 },
			},
			500,
		);
		const result = analyzeMetafile(metafile);
		expect(result).toContain("index.js");
		expect(result).toContain("cjs/react.production.js");
	});

	it("truncates to maxFilesInCell when a module has more than 10 files (plural suffix)", () => {
		const inputs: Record<string, { bytesInOutput: number }> = {};
		for (let i = 1; i <= 12; i++) {
			inputs[`node_modules/big/file${i}.js`] = { bytesInOutput: 100 };
		}
		const result = analyzeMetafile(makeMetafile(inputs, 1200));
		expect(result).toContain("other files");
	});

	it("uses singular suffix when exactly one file is truncated", () => {
		const inputs: Record<string, { bytesInOutput: number }> = {};
		for (let i = 1; i <= 11; i++) {
			inputs[`node_modules/big/file${i}.js`] = { bytesInOutput: 100 };
		}
		const result = analyzeMetafile(makeMetafile(inputs, 1100));
		expect(result).toContain("other file");
	});
});
