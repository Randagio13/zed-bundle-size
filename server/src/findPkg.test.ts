import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPkg, findPkgByName, findPkgs } from "./findPkg";

const serverDir = path.resolve(__dirname, "..");
const serverSrcDir = __dirname;

// Resolve bytes entry from the server's own node_modules
const bytesEntry = createRequire(
	path.resolve(serverDir, "<import>.js"),
).resolve("bytes");

// ── findPkg ────────────────────────────────────────────────────────────────

describe("findPkg", () => {
	it("finds the nearest package.json walking up from a directory", async () => {
		const result = await findPkg(serverSrcDir);
		expect(result).toMatch(/server[/\\]package\.json$/);
	});

	it("returns undefined when no package.json exists in any parent", async () => {
		// Filesystem root has no package.json
		const result = await findPkg("/");
		expect(result).toBeUndefined();
	});
});

// ── findPkgByName ──────────────────────────────────────────────────────────

describe("findPkgByName", () => {
	it("finds a package.json by walking up until the name matches", async () => {
		const result = await findPkgByName(bytesEntry, "bytes");
		expect(result).toMatch(/package\.json$/);
	});

	it("invokes the callback for every package.json encountered", async () => {
		const visited: string[] = [];
		await findPkgByName(bytesEntry, "bytes", (file) => visited.push(file));
		expect(visited.length).toBeGreaterThan(0);
	});

	it("returns undefined when no package.json with that name is found", async () => {
		const result = await findPkgByName(serverSrcDir, "__no_such_pkg__");
		expect(result).toBeUndefined();
	});
});

// ── findPkgs ───────────────────────────────────────────────────────────────

describe("findPkgs", () => {
	it("resolves root package metadata for an installed package", async () => {
		const result = await findPkgs("bytes", serverDir);
		expect(result.rootPkg?.name).toBe("bytes");
		expect(result.rootPkg?.version).toBeDefined();
	});

	it("resolves root package metadata for a scoped package", async () => {
		const result = await findPkgs("@babel/parser", serverDir);
		expect(result.rootPkg?.name).toBe("@babel/parser");
		expect(result.rootPkg?.version).toBeDefined();
	});

	it("handles packages whose package.json cannot be required (try/catch)", async () => {
		// 'escalade' is installed; require('escalade/package.json') throws
		// ERR_PACKAGE_PATH_NOT_EXPORTED — findPkgs must not propagate the error.
		const result = await findPkgs("escalade", serverDir);
		expect(result).toBeDefined();
	});
});
