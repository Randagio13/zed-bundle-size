import * as parser from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import type * as t from "@babel/types";

type Namespace = {
	name: string;
	usingProps: Array<{ start: number; end: number; name: string }>;
};

export type ImportInfo = {
	start: number;
	end: number;
	from: string;
	names?: Record<string, string>;
	namespace?: Namespace;
};

export type ParseResult = {
	imports: ImportInfo[];
};

export const parse = (input: string): ParseResult => {
	const ast = parser.parse(input, {
		sourceType: "module",
		errorRecovery: true,
		plugins: ["jsx", "typescript", ["decorators", {}]],
	});

	const format = (x: t.ImportDeclaration): ImportInfo => {
		const { start, end, specifiers, source } = x;
		const info: ImportInfo = {
			start: start as number,
			end: end as number,
			from: source.value,
		};
		for (const s of specifiers) {
			if (s.type === "ImportNamespaceSpecifier") {
				info.namespace = { name: s.local.name, usingProps: [] };
			} else if (s.type === "ImportDefaultSpecifier") {
				info.names ??= {};
				info.names.default = s.local.name;
			} else if (s.type === "ImportSpecifier") {
				if (s.importKind === "type") continue;
				info.names ??= {};
				const imported = s.imported;
				const importedName =
					imported.type === "StringLiteral"
						? imported.value
						: (imported as t.Identifier).name;
				info.names[importedName] = s.local.name;
			}
		}
		return info;
	};

	// Top-level imports only
	const imports = ast.program.body
		.filter((x): x is t.ImportDeclaration => {
			if (x.type !== "ImportDeclaration") return false;
			if (x.importKind === "type") return false;
			// Skip if all specifiers are type imports
			if (
				x.importKind === "value" &&
				x.specifiers.length > 0 &&
				x.specifiers.every(
					(s) => s.type === "ImportSpecifier" && s.importKind === "type",
				)
			) {
				return false;
			}
			return true;
		})
		.map(format);

	// Track namespace property accesses for `import * as foo from 'bar'`
	const namespaces = imports
		.map((x) => x.namespace)
		.filter((x): x is Namespace => Boolean(x));

	if (namespaces.length > 0) {
		const names = new Set(namespaces.map((x) => x.name));
		const createVisitor =
			<T extends t.Identifier | t.JSXIdentifier>(
				memberType: "MemberExpression" | "JSXMemberExpression",
				propType: "Identifier" | "JSXIdentifier",
			) =>
			(path: NodePath<T>) => {
				const { name } = path.node;
				if (!names.has(name)) return;
				const { parent } = path;
				if (parent.type === memberType) {
					const binding = path.scope.getBinding(name);
					if (
						binding &&
						binding.path.node.type === "ImportNamespaceSpecifier"
					) {
						const ns = namespaces.find((e) => e.name === name) as Namespace;
						if (parent.property.type === propType) {
							ns.usingProps.push({
								start: parent.start as number,
								end: parent.end as number,
								name: (parent.property as t.Identifier).name,
							});
						}
					}
				}
			};

		traverse(ast, {
			Identifier: createVisitor<t.Identifier>("MemberExpression", "Identifier"),
			JSXIdentifier: createVisitor<t.JSXIdentifier>(
				"JSXMemberExpression",
				"JSXIdentifier",
			),
		});
	}

	return { imports };
};

export const exportImported = (info: ImportInfo): string => {
	const { names, namespace } = info;
	return [
		names && `export {${Object.values(names).join(", ")}}`,
		namespace?.usingProps.length &&
			`export default [${namespace.usingProps
				.map((x) => `${namespace.name}.${x.name}`)
				.join(", ")}]`,
	]
		.filter(Boolean)
		.join("\n");
};
