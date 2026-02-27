# OpenFlux Architecture Migration: Electron → Tauri 2.0

**Created:** 2026-02-20  
**Author:** Development Team  
**Status:** Published  

## Overview

This document records the complete migration of OpenFlux from an Electron monolithic architecture to a Tauri 2.0 three-layer architecture, covering architecture changes, module separation, technology choices, fixed issues, and current status.

---

## 1. Migration Background

### 1.1 Problems with the Old Architecture

The old OpenFlux was built on **Electron + electron-vite** monolithic architecture:

- **Large installer**: Electron ships with Chromium (~120MB), total installer 200MB+
- **High memory usage**: Electron itself consumes 150-300MB
- **Complex cross-platform builds**: `electron-builder` frequently fails on native modules (sharp, better-sqlite3, keysender)
- **Main process coupling**: All backend logic (LLM, Agent, tools, scheduler, session management) runs in the Electron main process with blurred module boundaries
- **Slow startup**: Electron cold start takes 3-5 seconds

### 1.2 Migration Goals

- Installer < 30MB (excluding Gateway dependencies)
- 50%+ memory reduction
- Clean three-layer architecture separation
- Native window experience
- Support Windows + macOS

---

## 2. New Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                   OpenFlux Tauri                  │
├───────────┬──────────────────┬────────────────────┤
│ Rust Shell│ Frontend(Vite+TS)│ Gateway Sidecar    │
│  (Tauri)  │  (WebView)       │ (Node.js/tsx)      │
├───────────┼──────────────────┼────────────────────┤
│ • Window  │ • UI Rendering   │ • LLM Calls        │
│ • Tray    │ • WS Client      │ • Agent Engine     │
│ • File I/O│ • Voice UI       │ • Tool Execution   │
│ • Process │ • Markdown       │ • Session Mgmt     │
│ • Gateway │ • Particles      │ • Scheduler        │
│   Mgmt    │                  │ • Browser Auto     │
│ • Config  │                  │ • MCP Client       │
└───────────┴──────────────────┴────────────────────┘
       │              │                  │
       ▼              ▼                  ▼
   Native APIs    WebView2/WKWebView   ws://localhost:18801
```

### 2.1 Three-Layer Responsibilities

| Layer | Tech Stack | Responsibility | Directory |
|-------|-----------|----------------|-----------|
| **Rust Shell** | Tauri 2.0 + Rust | Window, tray, file ops, process management, Gateway lifecycle | `src-tauri/` |
| **Frontend** | Vite + TypeScript | UI rendering, WebSocket communication, voice, animation | `src/` + `index.html` |
| **Gateway Sidecar** | Node.js + TypeScript | All AI business logic (LLM, Agent, tools, MCP, etc.) | `gateway/` |

---

## 3. Module Changes

### 3.1 Rust Shell (`src-tauri/`)

| File | Function |
|------|----------|
| `lib.rs` | App entry, Tauri Builder init, auto-start Gateway sidecar |
| `main.rs` | Process entry point |
| `config.rs` | Read `openflux.yaml` config (host/port/token) |
| `tray.rs` | System tray (show window, quit) |
| `commands/gateway.rs` | Gateway sidecar start/stop/restart |
| `commands/window.rs` | Window control (minimize/maximize/close/flash) |
| `commands/file.rs` | File operations (read/save/open/locate) |
| `commands/system.rs` | App restart |

### 3.2 Frontend (`src/` + `index.html`)

| Item | Old | New |
|------|-----|-----|
| Bundler | electron-vite | Vite 6.4 |
| Dev port | 5173 | 1420 |
| Entry | `src/renderer/index.html` | `index.html` (root) |
| Backend comm | Electron IPC | Tauri invoke + WebSocket |

### 3.3 Gateway Sidecar (`gateway/`)

Fully extracted from Electron main process as an independent Node.js service (84 source files).

| Directory | Function | Files |
|-----------|----------|-------|
| `agent/` | Agent engine, runner, collaboration | 12 |
| `browser/` | Playwright browser automation | 7 |
| `config/` | Config loader + schema | 2 |
| `core/` | Bootstrap (tool registration) | 2 |
| `gateway/` | WebSocket server, standalone entry | 6 |
| `llm/` | LLM Providers (OpenAI/Anthropic) | 5 |
| `tools/` | Tool set (file, desktop, browser, MCP, etc.) | 27 |
| `workflow/` | Workflow engine | 5 |

---

## 4. Comparison

| Dimension | Electron | Tauri 2.0 |
|-----------|----------|-----------|
| **Framework** | Electron 33 | Tauri 2.0 + Rust |
| **Frontend Engine** | Embedded Chromium | System WebView2/WKWebView |
| **Backend** | Node.js (main process) | Rust shell + Node.js sidecar |
| **Installer Size** | ~200MB | ~30MB (excl. node_modules) |
| **Memory** | ~300MB | ~100MB (Rust shell) + Gateway |
| **IPC** | Electron IPC | Tauri invoke |
| **Process Model** | Main + Renderer | Rust + WebView + Node.js sidecar |
