import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasFile, measureIterable } from "./measure";

const serverDir = path.resolve(__dirname, "..");
// A real TypeScript file that exists on disk — used as fileName anchor
const thisFile = __filename;

// ── hasFile ────────────────────────────────────────────────────────────────

describe("hasFile", () => {
	it("returns true for a path that exists", async () => {
		expect(await hasFile(thisFile)).toBe(true);
	});

	it("returns false for a path that does not exist", async () => {
		expect(await hasFile("/nonexistent/path/file.ts")).toBe(false);
	});
});

// ── measureIterable ────────────────────────────────────────────────────────

async function collect(
	gen: AsyncGenerator<Awaited<ReturnType<typeof measureIterable>>[number]>,
) {
	const results = [];
	for await (const r of gen) results.push(r);
	return results;
}

describe("measureIterable", () => {
	it("yields a result with size for a valid npm import", async () => {
		const results = await collect(
			measureIterable("import bytes from 'bytes'", thisFile),
		);
		expect(results).toHaveLength(1);
		expect(results[0].result?.size).toBeGreaterThan(0);
		expect(results[0].error).toBeUndefined();
	});

	it("yields a result for a scoped npm package (@babel/parser)", async () => {
		const results = await collect(
			measureIterable("import { parse } from '@babel/parser'", thisFile),
		);
		expect(results[0].result?.size).toBeGreaterThan(0);
		expect(results[0].error).toBeUndefined();
	});

	it("marks transitive Node.js builtin imports as external", async () => {
		// escalade imports 'path', 'fs', 'util' — this triggers the
		// builtinExternalPlugin.onResolve callback for each builtin.
		const results = await collect(
			measureIterable("import escalade from 'escalade'", thisFile),
		);
		expect(results[0].result?.size).toBeGreaterThan(0);
		expect(results[0].error).toBeUndefined();
	});

	it("yields an error for a relative import", async () => {
		const results = await collect(
			measureIterable("import foo from './utils'", thisFile),
		);
		expect(results[0].error).toBeDefined();
		expect(String(results[0].error)).toContain("Skip");
	});

	it("yields an error for a Node.js built-in", async () => {
		const results = await collect(
			measureIterable("import fs from 'node:fs'", thisFile),
		);
		expect(results[0].error).toBeDefined();
	});

	it("throws when neither fileName nor workspaceFolder resolves to an existing path", async () => {
		const gen = measureIterable(
			"import bytes from 'bytes'",
			"/nonexistent/file.ts",
		);
		await expect(gen.next()).rejects.toThrow("Cannot resolve");
	});

	it("uses workspaceFolder when fileName does not exist", async () => {
		const results = await collect(
			measureIterable("import bytes from 'bytes'", null, {
				workspaceFolder: serverDir,
			}),
		);
		expect(results[0].result?.size).toBeGreaterThan(0);
	});

	it("uses workspaceFolder as fallback when fileName path does not exist on disk", async () => {
		const results = await collect(
			measureIterable("import bytes from 'bytes'", "/nonexistent/file.ts", {
				workspaceFolder: serverDir,
			}),
		);
		expect(results[0].result?.size).toBeGreaterThan(0);
	});

	it("returns the same result on a cache hit (cache: true)", async () => {
		const opts = { cache: true };
		const src = "import { format } from 'bytes'";
		const [r1] = await collect(measureIterable(src, thisFile, opts));
		const [r2] = await collect(measureIterable(src, thisFile, opts));
		expect(r2.result?.size).toBe(r1.result?.size);
	});

	it("produces a markdown table when stats: 'table'", async () => {
		const results = await collect(
			measureIterable("import bytes from 'bytes'", thisFile, {
				stats: "table",
			}),
		);
		expect(results[0].result?.stats).toMatch(/\| Input \|/);
	});

	it("produces a tree string when stats: 'tree'", async () => {
		const results = await collect(
			measureIterable("import bytes from 'bytes'", thisFile, {
				stats: "tree",
			}),
		);
		expect(typeof results[0].result?.stats).toBe("string");
	});

	it("leaves stats undefined when stats: true (metafile generated but not rendered)", async () => {
		const results = await collect(
			measureIterable("import bytes from 'bytes'", thisFile, {
				stats: true,
			}),
		);
		expect(results[0].result?.stats).toBeUndefined();
	});

	it("accepts an external option to exclude specific packages from the bundle", async () => {
		const results = await collect(
			measureIterable("import bytes from 'bytes'", thisFile, {
				external: ["bytes"],
			}),
		);
		// bytes is marked external — build succeeds; bundle contains only the
		// re-export stub (the peer-external plugin path is exercised).
		expect(results[0].error).toBeUndefined();
		expect(results[0].result).toBeDefined();
	});

	it("uses baseDir as workingDir when no package.json exists above it", async () => {
		// os.tmpdir() has no package.json above it; findPkg returns undefined
		// so workingDir falls back to baseDir. The build will fail because
		// there are no node_modules in tmpdir — that's expected.
		const tmpDir = os.tmpdir();
		const results = await collect(
			measureIterable("import bytes from 'bytes'", null, {
				workspaceFolder: tmpDir,
			}),
		);
		expect(results[0].error).toBeDefined();
	});

	it("yields zero size for a side-effect-only import of a sideEffects:false package", async () => {
		// empty-pkg has sideEffects:false and no actual runtime code is imported
		const results = await collect(
			measureIterable("import 'empty-pkg'", thisFile),
		);
		expect(results[0].result?.size).toBe(0);
		expect(results[0].result?.zippedSize).toBe(0);
	});

	it("yields no results for a file with no imports", async () => {
		const results = await collect(measureIterable("const x = 1;", thisFile));
		expect(results).toHaveLength(0);
	});
});
