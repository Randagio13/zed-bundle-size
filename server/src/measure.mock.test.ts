/**
 * Tests for branches in measure.ts that require mocking ./findPkg:
 *
 *  1. findPkg() throws → `.catch(() => null)` callback fires
 *  2. findPkgs() returns rootPkg=undefined → bundle result has pkg=undefined
 *  3. findPkgs() returns modulePkg defined → bundle result has modulePkg set
 *
 * vi.mock is hoisted before imports so measure.ts picks up the mocked version.
 */

import { vi } from "vitest";

vi.mock("./findPkg", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./findPkg")>();
	return {
		...actual,
		findPkg: vi.fn(actual.findPkg),
		findPkgs: vi.fn(actual.findPkgs),
	};
});

import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPkg, findPkgs } from "./findPkg";
import { measureIterable } from "./measure";

const serverDir = path.resolve(__dirname, "..");
const thisFile = __filename;

async function collect(
	gen: AsyncGenerator<Awaited<ReturnType<typeof measureIterable>>[number]>,
) {
	const results = [];
	for await (const r of gen) results.push(r);
	return results;
}

afterEach(() => {
	vi.mocked(findPkg).mockReset();
	vi.mocked(findPkgs).mockReset();
});

describe("measureIterable – mocked findPkg / findPkgs", () => {
	it("handles findPkg throwing (catch(() => null) path)", async () => {
		// When findPkg throws, projectPkgFile falls back to null and workingDir
		// becomes baseDir. The build should still succeed if bytes is resolvable.
		vi.mocked(findPkg).mockRejectedValueOnce(new Error("simulated fs error"));

		const results = await collect(
			measureIterable("import bytes from 'bytes'", null, {
				workspaceFolder: serverDir,
			}),
		);
		expect(results[0].result?.size).toBeGreaterThan(0);
		expect(results[0].error).toBeUndefined();
	});

	it("sets pkg to undefined in result when findPkgs returns no rootPkg", async () => {
		// When findPkgs resolves with rootPkg=undefined the ternary on the result
		// object takes the falsy branch: `rootPkg ? pickPkg(rootPkg) : undefined`.
		vi.mocked(findPkgs).mockResolvedValueOnce({
			rootPkg: undefined,
			rootPkgFile: undefined,
			modulePkg: undefined,
			modulePkgFile: undefined,
		});

		const results = await collect(
			measureIterable("import bytes from 'bytes'", null, {
				workspaceFolder: serverDir,
			}),
		);
		expect(results[0].error).toBeUndefined();
		expect(results[0].result?.pkg).toBeUndefined();
		expect(results[0].result?.pkgFile).toBeUndefined();
	});

	it("populates modulePkg in result when findPkgs returns a nested module package", async () => {
		// When findPkgs resolves with modulePkg defined the ternary takes the
		// truthy branch: `modulePkg ? pickPkg(modulePkg) : undefined`.
		vi.mocked(findPkgs).mockResolvedValueOnce({
			rootPkg: { name: "bytes", version: "1.0.0" },
			rootPkgFile: path.join(serverDir, "node_modules/bytes/package.json"),
			modulePkg: { name: "bytes-inner", version: "1.0.0" },
			modulePkgFile: path.join(
				serverDir,
				"node_modules/bytes/inner/package.json",
			),
		});

		const results = await collect(
			measureIterable("import bytes from 'bytes'", null, {
				workspaceFolder: serverDir,
			}),
		);
		expect(results[0].error).toBeUndefined();
		expect(results[0].result?.modulePkg?.name).toBe("bytes-inner");
		expect(results[0].result?.modulePkgFile).toBeDefined();
	});
});
