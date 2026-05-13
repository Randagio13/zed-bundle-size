import { promises as fs } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import bytes from "bytes";
import analyzeMetafile from "./analyzeMetafile";
import { findPkg, findPkgs, type Pkg } from "./findPkg";
import { exportImported, type ImportInfo, parse } from "./parse";

const gzip = promisify(zlib.gzip);
const gzipSize = (buf: Buffer) => gzip(buf).then((x) => x.length);

const reBuiltin = RegExp(`^node:|^(${builtinModules.join("|")})(/|$)`);
const reNonRelative = /^[a-z@]/;

type StatsOpt = boolean | "tree" | "table";

export type BundleResult = {
	size: number;
	zippedSize: number;
	human: { size: string; zippedSize: string };
	pkg?: Pkg;
	pkgFile?: string;
	modulePkg?: Pkg;
	modulePkgFile?: string;
	stats?: string;
};

export type MeasureResult = {
	importInfo: ImportInfo;
	result?: BundleResult;
	error?: Error | unknown;
};

type MeasureOptions = {
	stats?: StatsOpt;
	cache?: boolean;
	workspaceFolder?: string;
	external?: string[];
};

const bundleCache = new Map<string, BundleResult>();

const pickPkg = (pkg: Pkg): Pkg =>
	({
		name: pkg.name,
		version: pkg.version,
		description: pkg.description,
		homepage: pkg.homepage,
		peerDependencies: pkg.peerDependencies,
	}) as Pkg;

/** Plugin that marks Node.js builtins as external */
const builtinExternalPlugin = (_esbuild: typeof import("esbuild")) => ({
	name: "builtin-external",
	setup(build: import("esbuild").PluginBuild) {
		build.onResolve({ filter: reBuiltin, namespace: "file" }, (args) => ({
			path: args.path,
			external: true,
		}));
	},
});

/** Plugin that marks peer dependencies as external */
const peerExternalPlugin = (
	_esbuild: typeof import("esbuild"),
	peerDeps: string[],
) => ({
	name: "peer-external",
	setup(build: import("esbuild").PluginBuild) {
		if (peerDeps.length === 0) return;
		const filter = new RegExp(
			`^(${peerDeps.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(/|$)`,
		);
		build.onResolve({ filter, namespace: "file" }, (args) => ({
			path: args.path,
			external: true,
		}));
	},
});

async function bundle(
	statement: string,
	importInfo: ImportInfo,
	{
		baseDir,
		projectPkgFile,
		stats: statsOpt = false,
		cache: cacheOpt = false,
		external: externalOpt = [],
	}: {
		baseDir: string;
		projectPkgFile?: string | null;
		stats?: StatsOpt;
		cache?: boolean;
		external?: string[];
	},
): Promise<BundleResult> {
	const modulePath = importInfo.from;

	if (!reNonRelative.test(modulePath.charAt(0))) {
		throw new Error("Skip non-npm packages");
	}
	if (reBuiltin.test(modulePath)) {
		throw new Error("Skip builtin modules");
	}

	// esbuild is installed at runtime by the Rust extension
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const esbuild = require("esbuild") as typeof import("esbuild");

	const entryInput = `${statement}\n${exportImported(importInfo)}`;
	const { rootPkgFile, rootPkg, modulePkgFile, modulePkg } = await findPkgs(
		modulePath,
		baseDir,
	).catch(() => ({}) as Awaited<ReturnType<typeof findPkgs>>);

	const cacheKey =
		cacheOpt && rootPkg
			? `${rootPkg.name}:${rootPkg.version}:${entryInput}`
			: null;

	if (cacheKey) {
		const cached = bundleCache.get(cacheKey);
		if (cached) return cached;
	}

	const peerDeps = [
		...new Set([
			...Object.keys(rootPkg?.peerDependencies ?? {}),
			...externalOpt,
		]),
	];

	const workingDir = projectPkgFile ? path.dirname(projectPkgFile) : baseDir;

	const buildResult = await esbuild.build({
		stdin: {
			loader: "ts",
			contents: entryInput,
			resolveDir: workingDir,
			sourcefile: "<import>",
		},
		outfile: "<bundle>.js",
		absWorkingDir: workingDir,
		plugins: [
			builtinExternalPlugin(esbuild),
			peerExternalPlugin(esbuild, peerDeps),
		],
		resolveExtensions: [
			".ios.js",
			".android.js",
			".native.js",
			".jsx",
			".js",
			".tsx",
			".ts",
			".css",
			".json",
		],
		loader: {
			".node": "binary",
			".jpeg": "empty",
			".jpg": "empty",
			".png": "empty",
			".webp": "empty",
			".gif": "empty",
		},
		external: peerDeps,
		target: "esnext",
		format: "esm",
		platform: "browser",
		metafile: statsOpt !== false,
		minify: true,
		bundle: true,
		write: false,
	});

	await esbuild.stop();

	let stats: string | undefined;
	if (buildResult.metafile && statsOpt !== false) {
		if (statsOpt === "table") {
			stats = analyzeMetafile(buildResult.metafile);
		} else if (statsOpt === "tree") {
			stats = await esbuild.analyzeMetafile(buildResult.metafile);
		}
	}

	const sizes = await Promise.all(
		buildResult.outputFiles.map(async (file) => {
			const s = file.contents.length;
			return [s, s === 0 ? 0 : await gzipSize(Buffer.from(file.contents))] as [
				number,
				number,
			];
		}),
	);

	let size = 0;
	let zippedSize = 0;
	for (const [s, z] of sizes) {
		size += s;
		zippedSize += z;
	}

	const toRelative = (p: string) => path.relative(process.cwd(), p);
	const result: BundleResult = {
		size,
		zippedSize,
		human: { size: bytes(size), zippedSize: bytes(zippedSize) },
		pkg: rootPkg ? pickPkg(rootPkg) : undefined,
		pkgFile: rootPkgFile ? toRelative(rootPkgFile) : undefined,
		modulePkg: modulePkg ? pickPkg(modulePkg) : undefined,
		modulePkgFile: modulePkgFile ? toRelative(modulePkgFile) : undefined,
		stats,
	};

	if (cacheKey) {
		bundleCache.set(cacheKey, result);
	}

	return result;
}

const withValue = async <T>(
	fn: () => Promise<T>,
): Promise<[undefined, T] | [unknown, undefined]> => {
	try {
		return [undefined, await fn()];
	} catch (err) {
		return [err, undefined];
	}
};

export const hasFile = async (file: string): Promise<boolean> =>
	fs.stat(file).then(
		() => true,
		() => false,
	);

export async function* measureIterable(
	input: string,
	fileName?: string | null,
	opts: MeasureOptions = {},
): AsyncGenerator<MeasureResult> {
	const { stats, cache, workspaceFolder, external } = opts;

	const baseDir =
		fileName && (await hasFile(fileName))
			? path.dirname(fileName)
			: workspaceFolder && (await hasFile(workspaceFolder))
				? workspaceFolder
				: null;

	if (!baseDir) {
		throw new Error("Cannot resolve `fileName` or `workspaceFolder`");
	}

	const projectPkgFile = await findPkg(baseDir).catch(() => null);
	const { imports } = parse(input);

	const bundleOpts = {
		baseDir,
		projectPkgFile,
		stats,
		cache,
		external,
	};

	for (const importInfo of imports) {
		const statement = input.substring(importInfo.start, importInfo.end);
		const [error, result] = await withValue(() =>
			bundle(statement, importInfo, bundleOpts),
		);
		yield { importInfo, result, error };
	}
}
