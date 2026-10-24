# DevMate Studio Product Requirements and Delivery Tracker

## Source and status policy

This tracker reflects the DevMate Studio product analysis supplied in the implementation request and evidence in the current `main` checkout. The repository README is still the Vite template and no separate product analysis document exists in the checkout; detailed requirements beyond the supplied module names and explicit Core Studio milestone remain to be refined with the canonical analysis. Each listed requirement has exactly one status. `Implemented` means source evidence exists; `Tested` is reserved for behavior exercised by repository tests. A frontend build is not an end-to-end desktop test.

Status values: `Not Started`, `In Progress`, `Implemented`, `Tested`, `Blocked`.

## 1. Core Studio and workspace management

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| Select and open a project directory | Implemented | `src/App.tsx` uses the Tauri dialog plugin and calls `list_workspace`; native desktop interaction has not been manually tested in this environment. |
| Display real files and folders | Implemented | `src-tauri/src/lib.rs` enumerates filesystem entries and `src/App.tsx` renders `ProjectTree`; no desktop end-to-end test exists. |
| Read text files into Monaco | Implemented | `read_text_file` is invoked by the explorer selection handler and passed to Monaco; binary and invalid UTF-8 files are rejected in Rust. |
| Save edits to disk | Tested | Rust test `workspace_file_operations_round_trip` exercises create, write, read, rename, and delete; frontend-to-Tauri IPC has not been desktop-tested. |
| Create, rename, and delete files/folders | Tested | Rust tests exercise file and nested-directory CRUD; Explorer actions exist, but desktop UI/IPC flows have not been manually tested. Delete requires confirmation. |
| Protect unsaved changes during transitions | Implemented | `resolveUnsavedChanges` prompts to save or discard and aborts navigation if saving fails; not covered by UI tests. |
| Surface filesystem errors | Implemented | Rust commands return errors and the frontend presents an error banner; no desktop error-flow test exists. |
| Restrict filesystem operations to selected workspace | Tested | Rust canonical path checks reject outside-root access and workspace-root rename/delete; tests cover these boundaries. |
| Reject unsafe symlink operations | Tested | Listing skips symlinks; Rust path resolution rejects every symlink component, including aliases whose targets remain inside the workspace; Unix tests cover outside, internal, and dangling symlinks. Race-resistant descriptor-relative filesystem access is not established. |
| Persistent workspace reopening and session recovery | Not Started | Workspace root and editor state are React memory only; no persisted recent-workspace/session model exists. |

## 2. Professional Code Studio

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| Monaco editing surface with syntax mode selection | Implemented | `src/App.tsx` integrates Monaco, extension-based language detection, and a language selector. |
| Open-file tabs, dirty markers, cursor status | Implemented | React state renders tabs, dirty indicators, and cursor position; no interaction tests exist. |
| Language-server diagnostics, completion, navigation, refactoring, formatting, and debugging | Not Started | No language-server or debugger integration exists; the Problems view is placeholder content. |
| Real build/run integration | Not Started | No process runner exists. Do not treat the bottom-panel terminal/output mock as execution. |

## 3. AI Brain and agents

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| AI assistant, model/provider integration, and context retrieval | Not Started | No AI provider, chat workflow, retrieval layer, or provider configuration exists. |
| Specialized agents and tool permissions | Not Started | No agent runtime, tool registry, or execution authorization exists. |
| AI activity, cost, and audit controls | Not Started | No AI governance or usage tracking exists. |

## 4. Learning Center

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| Learning paths, lessons, and progress tracking | Not Started | No learning content, learner profile, or progress persistence exists. |
| Project-based learning and skills progression | Not Started | No curriculum or skill model exists. |

## 5. Exam and Assessment Center

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| Assessment authoring, delivery, and scoring | Not Started | No assessment domain model or workflows exist. |
| Secure/proctored assessment and accommodations | Not Started | No exam controls exist; privacy, accessibility, and policy requirements need product/legal review before implementation. |

## 6. Multilingual Workspace

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| Localized application UI and language selection | Not Started | UI strings are inline English; no localization framework or translation catalog exists. |
| Multilingual learning and assessment content | Not Started | No localized content system exists. |

## 7. Collaboration and Project Management

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| Shared projects, collaboration, and presence | Not Started | No identity, backend service, synchronization, or collaboration workflow exists. |
| Tasks, milestones, and team project management | Not Started | No project-management data model or UI exists. |

## 8. Security, Privacy, and Governance

| Requirement | Status | Repository evidence and remaining evidence |
|---|---|---|
| Native workspace path validation | Tested | Rust canonicalization, root protection, and symlink-focused tests are in `src-tauri/src/lib.rs`; TOCTOU resistance for hostile concurrent filesystem changes is not established. |
| Least-privilege Tauri capabilities | Implemented | `src-tauri/capabilities/default.json` enables the core defaults and only `dialog:allow-open`; native dialog operation still needs desktop verification. |
| Content Security Policy | Implemented | `src-tauri/tauri.conf.json` now defines separate production and Vite-development policies, allowing only required app/IPC origins, local dev/HMR in development, inline styles used by Monaco, and blob workers. WebView enforcement still needs desktop verification. |
| Dependency security override | Implemented | `package.json` retains the required `dompurify` override at `3.4.17`; this tracker does not claim a fresh security audit. |
| Secrets management, privacy controls, retention, and audit trails | Not Started | No secret-bearing frontend code is present, but these governance features are not implemented. |
| Legal/regulatory compliance | Not Started | No legal review or compliance evidence exists; no compliance claim is made. |

## Dependency-based implementation sequence

1. **Core Studio foundation:** finish native desktop verification of directory selection, file operations, unsaved-change flows, errors, and CSP/capability behavior; add frontend workflow tests. Keep terminal execution out of this milestone.
2. **Professional Code Studio:** add language-service and diagnostics architecture, then validated build/run integration with explicit execution controls and workspace scoping.
3. **Security and governance foundation:** define the threat model, CSP, capability policy, secret handling, privacy/retention rules, and audit requirements before introducing remote AI or collaboration services.
4. **AI Brain and agents:** implement provider abstraction, context boundaries, user consent, tool authorization, and auditable agent execution; depends on workspace APIs and governance.
5. **Learning Center:** define learner identity/progress/content models and integrate project-based learning with the code studio.
6. **Exam and Assessment Center:** build on learning content and identity; conduct accessibility, privacy, integrity, and legal review before any proctoring feature.
7. **Multilingual Workspace:** establish localization infrastructure before expanding UI/content surface; localize the core shell early as part of implementation.
8. **Collaboration and Project Management:** requires identity, server-side persistence, authorization, conflict handling, and privacy model; keep local-first workspace useful independently.

## Verification record

The Core Studio implementation was checked with:

- `npm run build` — passed (TypeScript project build and Vite production bundle).
- `npm run lint` — passed (Oxlint).
- `cargo check --manifest-path src-tauri/Cargo.toml` — passed after final backend edits.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 6 passed, 0 failed (file and directory CRUD, root/outside protection, symlink listing, external/internal/dangling symlink rejection).

A native Tauri desktop session and frontend-to-native IPC/manual interaction were not exercised here. `npx tauri dev` started Vite and compiled the Rust app, but the app exited before showing a window with `Failed to initialize GTK`; this container has no `DISPLAY` or Wayland session. The standalone `cargo tauri` subcommand is not installed; `npx tauri dev` is the supported repository launch command. Complete the steps below on a Windows desktop before calling the workspace milestone end-to-end verified.

## Windows desktop verification steps

1. On Windows, install Node.js, Rust with the MSVC target, Visual Studio C++ Build Tools, and the WebView2 runtime. From the repository root run `npm ci`, then `npx tauri dev`.
2. Open a temporary workspace containing nested folders, a UTF-8 text file, a binary file, and a text file with invalid UTF-8. Confirm the Explorer shows real entries, text opens in Monaco, and binary/invalid text errors are visible.
3. Edit and save a text file, then verify the on-disk content in Notepad. Make a file or parent directory read-only, edit and save again, and confirm the failure is shown and dirty state remains.
4. Create, rename, and delete a file; create, rename, and recursively delete a non-empty folder. Confirm duplicate names and names containing separators fail, and delete requires confirmation.
5. Open two files, edit one, and exercise save, discard, and cancel while switching files. Repeat when opening another workspace and closing the current workspace. Confirm save failure never silently switches or closes.
6. Create a symbolic link inside the workspace to an outside file and another link to an in-workspace file (PowerShell `New-Item -ItemType SymbolicLink -Path <link> -Target <target>`; symlink creation may require Developer Mode or elevation). Confirm links are not listed and cannot be opened, saved, renamed, or deleted through workspace operations. Confirm the selected workspace root cannot be renamed or deleted.
7. Confirm the dialog still opens folders under `dialog:allow-open`, the built app loads without CSP violations, Monaco editing/workers work, and the terminal panel remains explicitly non-executing.
