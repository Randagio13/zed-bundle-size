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

console.log("Bundle Size extension initialized");

connection.onInitialize((_params: InitializeParams): InitializeResult => {
	console.log("LSP Initialize called");
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			inlayHintProvider: true,
			hoverProvider: true,
		},
	};
});

connection.onInitialized(() => {
	console.log("LSP Initialized");
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
		console.log("Measuring document:", uri);
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

		// Send a proper workspace/inlayHint/refresh *request* (not a notification)
		// so Zed re-queries inlay hints after measurement completes on file open.
		console.log("Sending inlayHint/refresh for:", uri);
		await connection.languages.inlayHint.refresh();

	} catch (err) {
		console.error(`[bundle-size] Failed to measure ${uri}:`, err);
		connection.console.error(
			`[bundle-size] Failed to measure ${uri}: ${String(err)}`,
		);
	} finally {
		inFlight.delete(uri);
	}
}

function scheduleDoc(doc: TextDocument, delayMs = 50) {
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
	console.log("Document opened:", e.document.languageId);
	if (SUPPORTED.has(e.document.languageId)) scheduleDoc(e.document, 0);
});

documents.onDidChangeContent((e) => {
	console.log("Document changed:", e.document.languageId);
	if (SUPPORTED.has(e.document.languageId)) scheduleDoc(e.document, 50);
});

documents.onDidClose((e) => {
	measureCache.delete(e.document.uri);
	const t = debounceTimers.get(e.document.uri);
	if (t) clearTimeout(t);
	debounceTimers.delete(e.document.uri);
});

// ── Inlay Hints ────────────────────────────────────────────────────────────

connection.languages.inlayHint.on((params: InlayHintParams): InlayHint[] => {
	console.log("Inlay hint request for:", params.textDocument.uri);
	const doc = documents.get(params.textDocument.uri);
	if (!doc || !SUPPORTED.has(doc.languageId)) {
		console.log("Unsupported document or language");
		return [];
	}

	const results = measureCache.get(params.textDocument.uri);
	if (!results) {
		console.log("No results cached, triggering measurement");
		// Kick off measurement; client will get a proper refresh request when done
		void scheduleDoc(doc, 0);
		return [];
	}

	console.log("Returning", results.length, "inlay hints");

	return results
		.filter((r) => r.result != null)
		.map((r) => {
			const pos = doc.positionAt(r.importInfo.end);
			const { size, zippedSize } = r.result!.human;

			// Ensure proper positioning right after the import statement
			const hintPosition = {
				line: pos.line,
				character: Math.max(0, pos.character + 1),
			};

			return {
				position: hintPosition,
				label: `${size} (${zippedSize} gzipped)`,
				kind: InlayHintKind.Type,
				paddingLeft: true,
			} satisfies InlayHint;
		});
});

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

console.log("Bundle Size server started and listening");
