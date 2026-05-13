/**
 * Edge-case tests for findPkgs that require mocking `createRequire` from
 * `node:module`. ESM namespace objects are not configurable, so `vi.spyOn`
 * cannot replace named exports of built-in modules. Instead we declare
 * `vi.mock` here (Vitest hoists it before any imports) so that both this
 * test file and the `findPkg.ts` module it loads will share the same mocked
 * `createRequire`.
 */

import { vi } from "vitest";

vi.mock("node:module", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:module")>();
	return { ...actual, createRequire: vi.fn(actual.createRequire) };
});

import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findPkgs } from "./findPkg";

const serverDir = path.resolve(__dirname, "..");
const innerFixture = path.resolve(
	__dirname,
	"../test-fixtures/wrapper/inner/index.js",
);

afterEach(async () => {
	vi.mocked(createRequire).mockReset();
	const { createRequire: real } = await vi.importActual<
		typeof import("node:module")
	>("node:module");
	vi.mocked(createRequire).mockImplementation(real);
});

describe("findPkgs – mocked createRequire", () => {
	it("sets modulePkg when traversal passes through a nested package (pairs > 1)", async () => {
		// test-fixtures/wrapper/inner/index.js sits inside two package.json files:
		//   wrapper/inner/package.json  (name='inner-pkg', no match for 'outer-pkg')
		//   wrapper/package.json        (name='outer-pkg', match)
		// We make resolve() return that nested path so findPkgByName traverses both.
		const realCreateRequire = (
			await vi.importActual<typeof import("node:module")>("node:module")
		).createRequire;
		vi.mocked(createRequire).mockReturnValueOnce(
			Object.assign(realCreateRequire(path.resolve(serverDir, "<import>.js")), {
				resolve: () => innerFixture,
			}),
		);

		const result = await findPkgs("outer-pkg", serverDir);
		expect(result.rootPkg?.name).toBe("outer-pkg");
		expect(result.modulePkg?.name).toBe("inner-pkg");
	});

	it("skips traversal when moduleFile equals the module name", async () => {
		const realCreateRequire = (
			await vi.importActual<typeof import("node:module")>("node:module")
		).createRequire;
		vi.mocked(createRequire).mockReturnValueOnce(
			Object.assign(realCreateRequire(path.resolve(serverDir, "<import>.js")), {
				resolve: (id: string) => id, // module name returned as-is
			}),
		);

		// With moduleFile === moduleName the if-block is skipped entirely.
		const result = await findPkgs("bytes", serverDir);
		expect(result).toBeDefined();
		// rootPkg may still be populated from require('bytes/package.json')
		expect(result.modulePkg).toBeUndefined();
	});

	it("leaves rootPkg and modulePkg undefined when pkgFile is not found during traversal", async () => {
		const realCreateRequire = (
			await vi.importActual<typeof import("node:module")>("node:module")
		).createRequire;
		// Resolve to an existing file that lives inside the test fixtures tree.
		// findPkgByName will traverse up from there but none of the package.json
		// files encountered will have name === '__no_such_pkg__', so pkgFile
		// comes back undefined and the if-block is skipped.
		vi.mocked(createRequire).mockReturnValueOnce(
			Object.assign(realCreateRequire(path.resolve(serverDir, "<import>.js")), {
				resolve: () => innerFixture,
			}),
		);

		const result = await findPkgs("__no_such_pkg__", serverDir);
		// require('__no_such_pkg__/package.json') throws → rootPkg is undefined.
		// findPkgByName finds no matching package.json → pkgFile is undefined
		// → the if-block is skipped, so both rootPkg and modulePkg stay undefined.
		expect(result.rootPkg).toBeUndefined();
		expect(result.modulePkg).toBeUndefined();
	});
});
