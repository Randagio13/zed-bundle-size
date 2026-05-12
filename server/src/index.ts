import {
	createConnection,
	type Hover,
	type HoverParams,
	type InitializeParams,
	type InitializeResult,
	type InlayHint,
	InlayHintKind,
	type InlayHintParams,
	MarkupKind,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { type MeasureResult, measureIterable } from "./measure";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

/** Cache: document URI → completed measure results */
const measureCache = new Map<string, MeasureResult[]>();
/** Tracks URIs currently being measured to avoid duplicate work */
const inFlight = new Set<string>();
/** Debounce timers per URI */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const SUPPORTED = new Set([
	"javascript",
	"javascriptreact",
	"typescript",
	"typescriptreact",
]);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			inlayHintProvider: true,
			hoverProvider: true,
		},
	};
});

connection.onInitialized(() => {
	connection.sendNotification("window/showMessage", {
		type: 3, // MessageType.Info
		message:
			'Bundle Size: add `"inlay_hints": { "enabled": true }` to your Zed settings to see inline sizes.',
	});
});

async function measureDoc(doc: TextDocument): Promise<void> {
	const uri = doc.uri;
	if (inFlight.has(uri)) return;
	inFlight.add(uri);

	try {
		const filePath = uri.startsWith("file://")
			? decodeURIComponent(uri.slice(7))
			: uri;
		const results: MeasureResult[] = [];

		for await (const r of measureIterable(doc.getText(), filePath, {
			cache: true,
			stats: "table",
		})) {
			results.push(r);
		}

		measureCache.set(uri, results);
		// Tell the client to refresh its inlay hints
		connection.sendNotification("workspace/inlayHint/refresh");
	} catch (err) {
		connection.console.error(
			`[bundle-size] Failed to measure ${uri}: ${String(err)}`,
		);
	} finally {
		inFlight.delete(uri);
	}
}

function scheduleDoc(doc: TextDocument, delayMs = 300) {
	const uri = doc.uri;
	const existing = debounceTimers.get(uri);
	if (existing) clearTimeout(existing);
	debounceTimers.set(
		uri,
		setTimeout(() => {
			debounceTimers.delete(uri);
			void measureDoc(doc);
		}, delayMs),
	);
}

documents.onDidOpen((e) => {
	if (SUPPORTED.has(e.document.languageId)) scheduleDoc(e.document, 0);
});

documents.onDidChangeContent((e) => {
	if (SUPPORTED.has(e.document.languageId)) scheduleDoc(e.document, 500);
});

documents.onDidClose((e) => {
	measureCache.delete(e.document.uri);
	const t = debounceTimers.get(e.document.uri);
	if (t) clearTimeout(t);
	debounceTimers.delete(e.document.uri);
});

// ── Inlay Hints ────────────────────────────────────────────────────────────

connection.onRequest(
	"textDocument/inlayHint",
	(params: InlayHintParams): InlayHint[] => {
		const doc = documents.get(params.textDocument.uri);
		if (!doc || !SUPPORTED.has(doc.languageId)) return [];

		const results = measureCache.get(params.textDocument.uri);
		if (!results) {
			// Kick off measurement; client will get refresh notification when done
			void scheduleDoc(doc, 0);
			return [];
		}

		return results
			.filter((r) => r.result != null)
			.map((r) => {
				const pos = doc.positionAt(r.importInfo.end);
				const { size, zippedSize } = r.result!.human;
				return {
					position: pos,
					label: `${size} (${zippedSize} gzipped)`,
					kind: InlayHintKind.Type,
					paddingLeft: true,
				} satisfies InlayHint;
			});
	},
);

// ── Hover ──────────────────────────────────────────────────────────────────

connection.onHover((params: HoverParams): Hover | null => {
	const doc = documents.get(params.textDocument.uri);
	if (!doc) return null;

	const offset = doc.offsetAt(params.position);
	const results = measureCache.get(params.textDocument.uri);
	if (!results) return null;

	const hit = results.find(
		(r) => offset >= r.importInfo.start && offset <= r.importInfo.end,
	);
	if (!hit) return null;

	if (hit.error) {
		const msg =
			hit.error instanceof Error ? hit.error.message : String(hit.error);
		if (/Skip/.test(msg)) return null;
		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: `**Bundle error:** \`${msg}\``,
			},
		};
	}

	if (!hit.result) return null;

	const { size, zippedSize } = hit.result.human;
	const pkg = hit.result.pkg ?? hit.result.modulePkg;

	const lines: string[] = [];

	if (pkg) {
		const header = [
			pkg.name && pkg.version && `**${pkg.name}@${pkg.version}**`,
			pkg.homepage && `[Homepage](${pkg.homepage})`,
		]
			.filter(Boolean)
			.join(" | ");
		if (header) lines.push(header);
		if (pkg.description) lines.push(`_${pkg.description}_`);
		lines.push("");
	}

	lines.push(`📦 **${size}** minified`);
	lines.push(`🗜️ **${zippedSize}** gzipped`);

	if (hit.result.stats) {
		lines.push("", "---", "", hit.result.stats);
	}

	return {
		contents: {
			kind: MarkupKind.Markdown,
			value: lines.join("\n"),
		},
		range: {
			start: doc.positionAt(hit.importInfo.start),
			end: doc.positionAt(hit.importInfo.end),
		},
	};
});

documents.listen(connection);
connection.listen();
