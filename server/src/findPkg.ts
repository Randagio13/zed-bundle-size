import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import escalade from "escalade";

export type Pkg = {
	name: string;
	version: string;
	description?: string;
	homepage?: string;
	repository?: string;
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

export const findPkg = (file: string): Promise<string | undefined> => {
	return escalade(file, (_, names) => {
		if (names.includes("package.json")) {
			return "package.json";
		}
	});
};

const readJson = async (file: string): Promise<Record<string, unknown>> => {
	const content = await fs.readFile(file, "utf-8");
	return JSON.parse(content) as Record<string, unknown>;
};

export const findPkgByName = (
	file: string,
	moduleName: string,
	callback?: (file: string, pkg: Pkg) => void,
): Promise<string | undefined> => {
	return escalade(file, async (dir, names) => {
		if (names.includes("package.json")) {
			const pkgFile = path.join(dir, "package.json");
			const json = (await readJson(pkgFile)) as Pkg;
			callback?.(pkgFile, json);
			if (json.name === moduleName) {
				return "package.json";
			}
		}
	});
};

export const findPkgs = async (modulePath: string, baseDir: string) => {
	const contextRequire = createRequire(path.resolve(baseDir, "<import>.js"));
	const moduleFile = contextRequire.resolve(modulePath);

	const isScoped = modulePath[0] === "@";
	const [p1, p2] = isScoped
		? modulePath.split("/")
		: [modulePath.split("/")[0], ""];
	const moduleName = p1 + (isScoped ? "/" : "") + p2;

	let rootPkg: Pkg | undefined;
	let rootPkgFile: string | undefined;
	try {
		rootPkgFile = `${moduleName}/package.json`;
		rootPkg = require(rootPkgFile) as Pkg;
	} catch {
		// Package may not expose its package.json
	}

	let modulePkg: Pkg | undefined;
	let modulePkgFile: string | undefined;
	if (moduleFile !== moduleName) {
		const pairs: Array<[string, Pkg]> = [];
		const pkgFile = await findPkgByName(moduleFile, moduleName, (x, y) => {
			pairs.push([x, y]);
		});
		if (pkgFile && pairs.length > 0) {
			[rootPkgFile, rootPkg] = pairs[pairs.length - 1];
			if (pairs.length > 1) {
				[modulePkgFile, modulePkg] = pairs[0];
			}
		}
	}

	return { rootPkgFile, rootPkg, modulePkgFile, modulePkg };
};
