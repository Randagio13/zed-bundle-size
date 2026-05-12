# Bundle Size — Zed Extension

Display the minified + gzipped bundle size of npm packages inline in JavaScript and TypeScript import statements.

Inspired by the VS Code extension [vscode-bundle-size](https://github.com/ambar/vscode-bundle-size).

## Features

- ⚡ **Inline inlay hints** — shows `12.3 kB (4.1 kB gzipped)` after each import
- 🔍 **Hover card** — detailed per-module breakdown table on hover
- 🚀 **esbuild-powered** — fast, in-memory bundling with no file writing
- 📦 **Smart exclusions** — peer dependencies and Node.js builtins are excluded automatically
- 🧠 **Namespace import tracking** — `import * as foo from 'bar'` only counts used properties

## Supported Languages

- JavaScript (`.js`)
- TypeScript (`.ts`)
- JSX (`.jsx`)
- TSX (`.tsx`)

## Requirements

- Dependencies must be installed locally (`node_modules` must exist next to your file or up the directory tree)

## How It Works

The extension runs a Node.js [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) server that:

1. Parses import statements with `@babel/parser`
2. Bundles each import with `esbuild` (browser target, minified)
3. Gzips the output to get the compressed size
4. Returns results as **inlay hints** and **hover content** via LSP

## Development Setup

### Prerequisites

- [Rust via **rustup**](https://rustup.rs/) — Homebrew Rust is **not** supported by Zed's extension system
- [Node.js](https://nodejs.org/) ≥ 18
- [Zed](https://zed.dev/) editor

### Install the dev extension

```sh
# Install Node.js server dependencies and build the bundled server
cd server
pnpm install
pnpm build
cd ..
```

Then in Zed:
1. Open the **Extensions** panel (`zed: extensions`)
2. Click **Install Dev Extension**
3. Select this repository's directory

The Rust WASM wrapper is compiled automatically by Zed on first install.

### Rebuild the server after changes

```sh
cd server
pnpm build
```

Reinstall the dev extension in Zed to pick up changes.

## Architecture

```
zed-bundle-size/
  extension.toml          # Zed extension manifest
  Cargo.toml              # Rust WASM wrapper (thin shim)
  src/lib.rs              # Installs esbuild + starts the Node.js server
  server/
    src/
      index.ts            # LSP server (inlay hints + hover)
      measure.ts          # Bundle measurement via esbuild
      parse.ts            # Import statement parser (@babel/parser)
      findPkg.ts          # package.json resolution
      analyzeMetafile.ts  # esbuild metafile → markdown table
    dist/
      index.js            # Pre-built bundle (committed)
    build.mjs             # esbuild build script
    package.json
```

The Rust extension is a thin shim: it installs the `esbuild` npm package at runtime (required for in-project bundling with the correct platform binary), then starts `node server/dist/index.js --stdio`.

## License

MIT
