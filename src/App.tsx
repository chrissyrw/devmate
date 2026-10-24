import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import Editor from '@monaco-editor/react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Activity,
  BookOpen,
  Bug,
  ChevronDown,
  FileCode2,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  PencilLine,
  Search,
  Sparkles,
  SquareTerminal,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import './App.css'

const menuItems = ['File', 'Edit', 'Navigate', 'Run', 'Tools', 'Help']
const sideBarItems = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'source-control', label: 'Source Control', icon: GitBranch },
  { id: 'extensions', label: 'Extensions', icon: Sparkles },
] as const

const languageOptions = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'css', label: 'CSS' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'python', label: 'Python' },
  { value: 'plaintext', label: 'Plain Text' },
] as const

type EditorLanguage = (typeof languageOptions)[number]['value']
type SidebarView = (typeof sideBarItems)[number]['id']
type BottomTab = 'terminal' | 'problems' | 'output'
type ExplorerKind = 'directory' | 'file'

type ProjectFile = {
  id: string
  name: string
  path: string
  language: EditorLanguage
  code: string
  isDirty: boolean
}

type ExplorerNode = {
  name: string
  path: string
  kind: ExplorerKind
  children: ExplorerNode[]
}

const detectLanguageFromPath = (filePath: string): EditorLanguage => {
  const lower = filePath.toLowerCase()

  if (lower.endsWith('.tsx') || lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx') || lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown'
  if (lower.endsWith('.py')) return 'python'

  return 'plaintext'
}

const getBaseName = (path: string) => {
  const normalized = path.replace(/\\/g, '/')
  const segment = normalized.split('/').filter(Boolean).at(-1) ?? 'workspace'
  return segment || 'workspace'
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback

function ProjectTree({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: ExplorerNode[]
  selectedPath: string | null
  onSelect: (path: string, kind: ExplorerKind) => void
}) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => (
        <li key={node.path} className="tree-item">
          <div className={`tree-row ${selectedPath === node.path ? 'selected' : ''}`}>
            <button
              type="button"
              className="tree-node"
              onClick={() => onSelect(node.path, node.kind)}
            >
              {node.kind === 'directory' ? <FolderOpen size={14} /> : <FileCode2 size={14} />}
              <span>{node.name}</span>
            </button>
          </div>
          {node.children.length > 0 && (
            <ProjectTree nodes={node.children} selectedPath={selectedPath} onSelect={onSelect} />
          )}
        </li>
      ))}
    </ul>
  )
}

function App() {
  const [activeView, setActiveView] = useState<SidebarView>('explorer')
  const [activeMenu, setActiveMenu] = useState('File')
  const [bottomTab, setBottomTab] = useState<BottomTab>('terminal')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState('No workspace open')
  const [explorerTree, setExplorerTree] = useState<ExplorerNode[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedEntryKind, setSelectedEntryKind] = useState<ExplorerKind | 'workspace' | null>(null)
  const [files, setFiles] = useState<Record<string, ProjectFile>>({})
  const [editorValue, setEditorValue] = useState('')
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)

  const editorRef = useRef<{
    onDidChangeCursorPosition: (callback: (event: { position: { lineNumber: number; column: number } }) => void) => void
    getPosition: () => { lineNumber: number; column: number } | null
  } | null>(null)

  const selectedFile = useMemo(() => {
    if (!selectedPath || selectedEntryKind !== 'file') return null
    return files[selectedPath] ?? null
  }, [selectedEntryKind, files, selectedPath])

  const refreshWorkspaceTree = async (rootPath: string) => {
    try {
      const tree = (await invoke('list_workspace', { workspaceRoot: rootPath })) as ExplorerNode[]
      setExplorerTree(tree)
      setSelectedPath((current) => current ?? rootPath)
      setSelectedEntryKind((current) => current ?? 'workspace')
      return true
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to refresh workspace.'))
      return false
    }
  }

  const openWorkspace = async () => {
    try {
      setIsLoadingWorkspace(true)
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open workspace folder',
      })

      if (!selected || typeof selected !== 'string') {
        setIsLoadingWorkspace(false)
        return
      }

      if (!(await resolveUnsavedChanges())) return

      const rootPath = selected.replace(/\\/g, '/')
      const name = getBaseName(rootPath)

      const tree = (await invoke('list_workspace', { workspaceRoot: rootPath })) as ExplorerNode[]

      setWorkspaceRoot(rootPath)
      setWorkspaceName(name)
      setExplorerTree(tree)
      setSelectedPath(rootPath)
      setSelectedEntryKind('workspace')
      setFiles({})
      setEditorValue('')
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to open workspace folder.'))
    } finally {
      setIsLoadingWorkspace(false)
    }
  }

  const handleSelectNode = async (path: string, kind: ExplorerKind) => {
    if (!workspaceRoot) return

    if (!(await resolveUnsavedChanges())) return

    setSelectedPath(path)
    setSelectedEntryKind(kind)

    if (kind === 'file') {
      try {
        await loadFileIntoEditor(path, workspaceRoot)
      } catch (error) {
        const message = getErrorMessage(error, 'Unable to read this file.')
        setErrorMessage(message)
        setEditorValue('')
      }
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    if (!selectedPath || selectedEntryKind !== 'file') return

    const nextValue = value ?? ''
    setEditorValue(nextValue)
    setFiles((current) => {
      const currentFile = current[selectedPath]
      if (!currentFile) return current
      return {
        ...current,
        [selectedPath]: {
          ...currentFile,
          code: nextValue,
          isDirty: nextValue !== currentFile.code,
        },
      }
    })
  }

  const saveCurrentFile = async () => {
    if (!workspaceRoot || !selectedPath || selectedEntryKind !== 'file') return false

    try {
      const currentFile = files[selectedPath]
      if (!currentFile) return false

      await invoke('write_text_file', {
        workspaceRoot,
        path: selectedPath,
        content: editorValue,
      })

      setFiles((current) => ({
        ...current,
        [selectedPath]: {
          ...currentFile,
          code: editorValue,
          isDirty: false,
        },
      }))
      setErrorMessage(null)
      return true
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to save file.'))
      return false
    }
  }

  const loadFileIntoEditor = async (path: string, rootPath: string) => {
    const content = (await invoke('read_text_file', {
      workspaceRoot: rootPath,
      path,
    })) as string

    const nextFile: ProjectFile = {
      id: path,
      name: getBaseName(path),
      path,
      language: detectLanguageFromPath(path),
      code: content,
      isDirty: false,
    }

    setFiles((current) => ({ ...current, [path]: nextFile }))
    setEditorValue(content)
    setErrorMessage(null)
  }

  const resolveUnsavedChanges = async () => {
    const dirtyFiles = Object.values(files).filter((file) => file.isDirty)
    if (dirtyFiles.length === 0) return true

    const shouldSave = window.confirm('There are unsaved changes. Save them before continuing?')
    if (!shouldSave) {
      const shouldDiscard = window.confirm('Discard all unsaved changes?')
      if (!shouldDiscard) return false
      setFiles((current) => Object.fromEntries(
        Object.entries(current).map(([path, file]) => [path, { ...file, isDirty: false }]),
      ))
      return true
    }

    if (!workspaceRoot) return false
    try {
      for (const file of dirtyFiles) {
        await invoke('write_text_file', {
          workspaceRoot,
          path: file.path,
          content: file.path === selectedPath ? editorValue : file.code,
        })
      }
      setFiles((current) => Object.fromEntries(
        Object.entries(current).map(([path, file]) => [path, { ...file, isDirty: false }]),
      ))
      setErrorMessage(null)
      return true
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to save unsaved changes.'))
      return false
    }
  }

  const handleEditorMount = (editor: {
    onDidChangeCursorPosition: (callback: (event: { position: { lineNumber: number; column: number } }) => void) => void
    getPosition: () => { lineNumber: number; column: number } | null
  }) => {
    editorRef.current = editor
    const position = editor.getPosition()
    if (position) {
      setCursor({ line: position.lineNumber, column: position.column })
    }

    editor.onDidChangeCursorPosition((event) => {
      setCursor({
        line: event.position.lineNumber,
        column: event.position.column,
      })
    })
  }

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!selectedPath || selectedEntryKind !== 'file') return

    const nextLanguage = event.target.value as EditorLanguage
    setFiles((current) => {
      const currentFile = current[selectedPath]
      if (!currentFile) return current
      return {
        ...current,
        [selectedPath]: {
          ...currentFile,
          language: nextLanguage,
        },
      }
    })
  }

  const handleCreateNode = async (kind: 'file' | 'directory') => {
    if (!workspaceRoot) {
      setErrorMessage('Open a workspace before creating files or folders.')
      return
    }

    const promptLabel = kind === 'file' ? 'New file name' : 'New folder name'
    const value = window.prompt(promptLabel)
    if (!value || !value.trim()) return
    if (!(await resolveUnsavedChanges())) return

    const safeName = value.trim()
    const parentPath = selectedPath && selectedEntryKind !== 'file' ? selectedPath : workspaceRoot

    try {
      const createdPath = (await invoke('create_path', {
        workspaceRoot,
        parentPath,
        name: safeName,
        kind,
      })) as string

      if (!(await refreshWorkspaceTree(workspaceRoot))) return
      setSelectedPath(createdPath)
      setSelectedEntryKind(kind)
      if (kind === 'file') await loadFileIntoEditor(createdPath, workspaceRoot)
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, `Unable to create ${kind}.`))
    }
  }

  const handleRenameSelected = async () => {
    if (!workspaceRoot || !selectedPath) {
      setErrorMessage('Select a file or folder to rename.')
      return
    }
    const currentName = getBaseName(selectedPath)
    const nextName = window.prompt('Rename item', currentName)
    if (!nextName || !nextName.trim() || nextName.trim() === currentName) return
    if (!(await resolveUnsavedChanges())) return

    try {
      const renamedPath = (await invoke('rename_path', {
        workspaceRoot,
        oldPath: selectedPath,
        newName: nextName.trim(),
      })) as string

      if (!(await refreshWorkspaceTree(workspaceRoot))) return
      const oldPathPrefix = `${selectedPath.replace(/\/$/, '')}/`
      setFiles((current) => Object.fromEntries(
        Object.values(current).map((file) => {
          const nextPath = file.path === selectedPath
            ? renamedPath
            : file.path.startsWith(oldPathPrefix)
              ? `${renamedPath}${file.path.slice(selectedPath.length)}`
              : file.path
          return [nextPath, { ...file, id: nextPath, path: nextPath, name: getBaseName(nextPath) }]
        }),
      ))
      setSelectedPath(renamedPath)
      setSelectedEntryKind(selectedEntryKind === 'file' ? 'file' : 'directory')
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to rename item.'))
    }
  }

  const handleDeleteSelected = async () => {
    if (!workspaceRoot || !selectedPath) {
      setErrorMessage('Select a file or folder to delete.')
      return
    }
    const confirmed = window.confirm(`Delete ${getBaseName(selectedPath)}? This cannot be undone.`)
    if (!confirmed) return
    if (!(await resolveUnsavedChanges())) return

    try {
      await invoke('delete_path', {
        workspaceRoot,
        path: selectedPath,
      })
      setFiles((current) => {
        const deletedPathPrefix = `${selectedPath.replace(/\/$/, '')}/`
        return Object.fromEntries(
          Object.entries(current).filter(([path]) => path !== selectedPath && !path.startsWith(deletedPathPrefix)),
        )
      })

      if (selectedPath === workspaceRoot) {
        setSelectedPath(null)
        setSelectedEntryKind(null)
      }

      if (!(await refreshWorkspaceTree(workspaceRoot))) return
      setSelectedPath(workspaceRoot)
      setSelectedEntryKind('workspace')
      setErrorMessage(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to delete item.'))
    }
  }

  const handleCloseWorkspace = async () => {
    if (!(await resolveUnsavedChanges())) return

    setWorkspaceRoot(null)
    setWorkspaceName('No workspace open')
    setExplorerTree([])
    setSelectedPath(null)
    setSelectedEntryKind(null)
    setFiles({})
    setEditorValue('')
    setErrorMessage(null)
  }

  const renderSidePanel = () => {
    switch (activeView) {
      case 'explorer':
        return (
          <>
            <div className="panel-header-row">
              <span>Explorer</span>
              <button type="button" className="ghost-button" aria-label="Collapse explorer">
                <ChevronDown size={14} />
              </button>
            </div>

            <div className="panel-actions">
              <button type="button" className="tiny-button" onClick={() => openWorkspace()} disabled={isLoadingWorkspace}>
                {isLoadingWorkspace ? 'Loading…' : 'Open'}
              </button>
              <button type="button" className="tiny-button" onClick={() => handleCreateNode('file')}>
                <FilePlus2 size={12} />
                File
              </button>
              <button type="button" className="tiny-button" onClick={() => handleCreateNode('directory')}>
                <FolderPlus size={12} />
                Folder
              </button>
            </div>

            {workspaceRoot ? (
              <div className="workspace-info">
                <span className="workspace-pill">{workspaceName}</span>
                <div className="workspace-tools">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleRenameSelected}
                    title="Rename selected"
                    disabled={!selectedPath || selectedPath === workspaceRoot}
                  >
                    <PencilLine size={12} />
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleDeleteSelected}
                    title="Delete selected"
                    disabled={!selectedPath || selectedPath === workspaceRoot}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="empty-panel">
                <FolderOpen size={18} />
                <h3>No workspace</h3>
                <p>Open a real project folder to load files and folders into the Explorer.</p>
              </div>
            )}

            {workspaceRoot && <ProjectTree nodes={explorerTree} selectedPath={selectedPath} onSelect={handleSelectNode} />}
          </>
        )
      case 'search':
        return (
          <div className="empty-panel">
            <Search size={18} />
            <h3>Search workspace</h3>
            <p>Search indexing is not implemented yet; this panel is a placeholder for future workspace search.</p>
          </div>
        )
      case 'source-control':
        return (
          <div className="empty-panel">
            <GitBranch size={18} />
            <h3>Source control</h3>
            <p>Git integration is not implemented yet; this panel is a placeholder.</p>
          </div>
        )
      case 'extensions':
        return (
          <div className="empty-panel">
            <Sparkles size={18} />
            <h3>Extensions</h3>
            <p>Marketplace and extension integrations are not implemented yet.</p>
          </div>
        )
      default:
        return null
    }
  }

  const saveButtonLabel = selectedPath && selectedEntryKind === 'file' && files[selectedPath]?.isDirty ? 'Save' : 'Saved'

  return (
    <div className="ide-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">D</div>
          <span>DevMate Studio</span>
        </div>

        <nav className="menu-bar" aria-label="Top menu">
          {menuItems.map((menuItem) => (
            <button
              key={menuItem}
              type="button"
              className={`menu-button ${activeMenu === menuItem ? 'active' : ''}`}
              onClick={() => setActiveMenu(menuItem)}
            >
              {menuItem}
            </button>
          ))}
        </nav>

        <div className="window-chrome">
          <button type="button" className="window-button" onClick={openWorkspace} disabled={isLoadingWorkspace}>
            {isLoadingWorkspace ? 'Opening…' : 'Open Folder'}
          </button>
          <span className="dot red" />
          <span className="dot yellow" />
          <span className="dot green" />
        </div>
      </header>

      {errorMessage && (
        <div className="error-banner" role="alert">
          {errorMessage}
        </div>
      )}

      <div className="workspace-layout">
        <aside className="activity-sidebar" aria-label="Activity sidebar">
          {sideBarItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`activity-button ${activeView === id ? 'active' : ''}`}
              onClick={() => setActiveView(id)}
              title={label}
              aria-label={label}
            >
              <Icon size={18} />
            </button>
          ))}
        </aside>

        <aside className="side-panel">{renderSidePanel()}</aside>

        <main className="editor-shell">
          <div className="editor-toolbar">
            <div className="tab-strip" aria-label="Open files">
              {Object.values(files).map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={`tab-button ${selectedPath === file.path ? 'active' : ''}`}
                  onClick={() => handleSelectNode(file.path, 'file')}
                >
                  <FileCode2 size={14} />
                  <span>{file.name}</span>
                  {file.isDirty && <span className="dirty-dot" />}
                </button>
              ))}
            </div>

            <div className="toolbar-actions">
              <button type="button" className="ghost-button" onClick={saveCurrentFile} disabled={selectedEntryKind !== 'file'}>
                <Activity size={14} />
                <span>{saveButtonLabel}</span>
              </button>
              <button type="button" className="ghost-button" onClick={handleCloseWorkspace}>
                <BookOpen size={14} />
                <span>Close</span>
              </button>
            </div>
          </div>

          <div className="editor-header">
            <div className="header-meta">
              <div className="file-badge">
                <Folder size={12} />
                <span>{selectedPath ? selectedPath : 'No file selected'}</span>
              </div>
            </div>

            <div className="language-switcher">
              <label htmlFor="language-select">Language</label>
              <select
                id="language-select"
                value={selectedFile?.language ?? 'typescript'}
                onChange={handleLanguageChange}
                disabled={selectedEntryKind !== 'file'}
              >
                {languageOptions.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedFile ? (
            <div className="editor-container">
              <Editor
                height="100%"
                theme="vs-dark"
                language={selectedFile.language}
                value={editorValue}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  roundedSelection: true,
                  scrollBeyondLastLine: false,
                  padding: { top: 16, bottom: 16 },
                  glyphMargin: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                  tabSize: 2,
                }}
              />
            </div>
          ) : (
            <div className="empty-state">
              <FolderOpen size={28} />
              <h2>Welcome to DevMate Studio</h2>
              <p>{workspaceRoot ? 'Select a file from the project explorer to begin editing.' : 'Open an existing project folder to load real files into the editor.'}</p>
            </div>
          )}
        </main>
      </div>

      <section className="bottom-panel" aria-label="Development panel">
        <div className="bottom-tabs" role="tablist">
          {[
            { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
            { id: 'problems', label: 'Problems', icon: Bug },
            { id: 'output', label: 'Output', icon: SquareTerminal },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={bottomTab === id}
              className={`bottom-tab ${bottomTab === id ? 'active' : ''}`}
              onClick={() => setBottomTab(id as BottomTab)}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="bottom-content">
          {bottomTab === 'terminal' && (
            <div className="terminal-output">
              <div className="terminal-banner">Simulated terminal output — this is a UI mock and does not execute commands.</div>
              <pre>
{`$ npm run build
> devmate@0.0.0 build
> tsc -b && vite build
✓ TypeScript project compilation finished
✓ Vite bundle generation complete`}
              </pre>
            </div>
          )}

          {bottomTab === 'problems' && (
            <div className="panel-list">
              <div className="problem-item ok">
                <span className="status-pill good">0 errors</span>
                <span>No active TypeScript problems in the loaded workspace.</span>
              </div>
              <div className="problem-item">
                <span className="status-pill muted">Info</span>
                <span>Real file operations are backed by Tauri and are not simulated.</span>
              </div>
            </div>
          )}

          {bottomTab === 'output' && (
            <div className="panel-list">
              <div className="problem-item">
                <span className="status-pill muted">Build Output</span>
                <span>Output capture is still a placeholder; build commands are not executed from the UI yet.</span>
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="status-bar">
        <div className="status-left">
          <span>Type: {selectedFile?.language ?? 'none'}</span>
          <span>Line {cursor.line}</span>
          <span>Col {cursor.column}</span>
        </div>
        <div className="status-right">
          <span>{workspaceRoot ? `Workspace: ${workspaceName}` : 'No workspace'}</span>
          <span>{activeMenu}</span>
        </div>
      </footer>
    </div>
  )
}

export default App
