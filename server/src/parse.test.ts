import { describe, expect, it } from "vitest";
import { exportImported, parse } from "./parse";

// ── parse() ────────────────────────────────────────────────────────────────

describe("parse", () => {
	it("extracts a named import", () => {
		const { imports } = parse("import { foo } from 'bar'");
		expect(imports).toHaveLength(1);
		expect(imports[0].from).toBe("bar");
		expect(imports[0].names).toEqual({ foo: "foo" });
	});

	it("handles aliased named imports", () => {
		const { imports } = parse("import { foo as f } from 'bar'");
		expect(imports[0].names).toEqual({ foo: "f" });
	});

	it("extracts a default import", () => {
		const { imports } = parse("import React from 'react'");
		expect(imports[0].from).toBe("react");
		expect(imports[0].names).toEqual({ default: "React" });
	});

	it("extracts a namespace import", () => {
		const { imports } = parse("import * as ns from 'pkg'");
		expect(imports[0].from).toBe("pkg");
		expect(imports[0].namespace?.name).toBe("ns");
	});

	it("skips type-only import declarations", () => {
		const { imports } = parse("import type { Foo } from 'bar'");
		expect(imports).toHaveLength(0);
	});

	it("skips imports where every specifier is a type import", () => {
		const { imports } = parse("import { type Foo, type Bar } from 'bar'");
		expect(imports).toHaveLength(0);
	});

	it("keeps an import that mixes value and type specifiers", () => {
		const { imports } = parse("import { type Foo, bar } from 'pkg'");
		expect(imports).toHaveLength(1);
		expect(imports[0].names).toEqual({ bar: "bar" });
	});

	it("returns start/end offsets for the import statement", () => {
		const src = "import { foo } from 'bar'";
		const { imports } = parse(src);
		const { start, end } = imports[0];
		expect(src.substring(start, end)).toBe(src);
	});

	it("handles multiple imports in one file", () => {
		const src = "import a from 'a'\nimport b from 'b'";
		const { imports } = parse(src);
		expect(imports).toHaveLength(2);
		expect(imports.map((i) => i.from)).toEqual(["a", "b"]);
	});

	it("tracks namespace property accesses", () => {
		const src = `
import * as ns from 'pkg'
const x = ns.foo
const y = ns.bar
`;
		const { imports } = parse(src);
		const props = imports[0].namespace?.usingProps.map((p) => p.name);
		expect(props).toEqual(expect.arrayContaining(["foo", "bar"]));
	});
});

// ── exportImported() ───────────────────────────────────────────────────────

describe("exportImported", () => {
	it("generates re-export for named imports", () => {
		const info = { start: 0, end: 0, from: "pkg", names: { foo: "foo", bar: "bar" } };
		expect(exportImported(info)).toBe("export {foo, bar}");
	});

	it("generates re-export for a default import", () => {
		const info = { start: 0, end: 0, from: "pkg", names: { default: "Pkg" } };
		expect(exportImported(info)).toBe("export {Pkg}");
	});

	it("generates re-export for namespace with used props", () => {
		const info = {
			start: 0,
			end: 0,
			from: "pkg",
			namespace: {
				name: "ns",
				usingProps: [
					{ start: 0, end: 0, name: "foo" },
					{ start: 0, end: 0, name: "bar" },
				],
			},
		};
		expect(exportImported(info)).toBe("export default [ns.foo, ns.bar]");
	});

	it("returns empty string for a side-effect-only import", () => {
		const info = { start: 0, end: 0, from: "pkg" };
		expect(exportImported(info)).toBe("");
	});
});
