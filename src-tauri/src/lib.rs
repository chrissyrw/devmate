use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, serde::Serialize)]
pub struct ExplorerNode {
  pub name: String,
  pub path: String,
  pub kind: String,
  pub children: Vec<ExplorerNode>,
}

fn canonicalize_within_root(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
  let root_canonical = fs::canonicalize(root)
    .map_err(|err| format!("Unable to read workspace root '{}': {}", root.display(), err))?;

  let relative = candidate
    .strip_prefix(root)
    .or_else(|_| candidate.strip_prefix(&root_canonical))
    .map_err(|_| format!("Path '{}' is outside the selected workspace.", candidate.display()))?;
  let mut path_to_check = root_canonical.clone();

  for component in relative.components() {
    match component {
      std::path::Component::Normal(name) => path_to_check.push(name),
      std::path::Component::CurDir => continue,
      std::path::Component::ParentDir if path_to_check != root_canonical => {
        path_to_check.pop();
        continue;
      }
      std::path::Component::ParentDir => {
        return Err(format!("Path '{}' is outside the selected workspace.", candidate.display()));
      }
      _ => return Err(format!("Path '{}' is outside the selected workspace.", candidate.display())),
    }

    match fs::symlink_metadata(&path_to_check) {
      Ok(metadata) if metadata.file_type().is_symlink() => {
        return Err(format!("Symbolic links are not supported in workspace paths: '{}'.", path_to_check.display()));
      }
      Ok(_) => {}
      Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
      Err(err) => return Err(format!("Unable to inspect path '{}': {}", path_to_check.display(), err)),
    }
  }

  if path_to_check.exists() {
    path_to_check = fs::canonicalize(&path_to_check)
      .map_err(|err| format!("Unable to resolve path '{}': {}", path_to_check.display(), err))?;
  }

  if !path_to_check.starts_with(&root_canonical) {
    return Err(format!(
      "Path '{}' is outside the selected workspace.",
      candidate.display()
    ));
  }

  Ok(path_to_check)
}

fn safe_join(root: &Path, requested_path: &str) -> Result<PathBuf, String> {
  let requested = Path::new(requested_path);
  let boxed = if requested.is_absolute() {
    requested.to_path_buf()
  } else {
    root.join(requested)
  };

  canonicalize_within_root(root, &boxed)
}

mod commands {
  use super::*;

  fn collect_children(path: &Path) -> Result<Vec<ExplorerNode>, String> {
    let mut entries = Vec::new();

    let dir_entries = fs::read_dir(path)
      .map_err(|err| format!("Unable to list '{}': {}", path.display(), err))?;

    let mut names: Vec<_> = dir_entries
      .collect::<Result<_, _>>()
      .map_err(|err| format!("Unable to read an entry in '{}': {}", path.display(), err))?;

    names.sort_by(|a, b| {
      a.file_name()
        .to_string_lossy()
        .to_lowercase()
        .cmp(&b.file_name().to_string_lossy().to_lowercase())
    });

    for entry in names {
      let child_path = entry.path();
      let name = entry.file_name().to_string_lossy().to_string();

      let metadata = match fs::symlink_metadata(&child_path) {
        Ok(metadata) => metadata,
        Err(_) => continue,
      };

      if metadata.file_type().is_symlink() {
        continue;
      }

      if metadata.is_dir() {
        let children = collect_children(&child_path)?;

        entries.push(ExplorerNode {
          name,
          path: child_path.to_string_lossy().replace('\\', "/"),
          kind: "directory".into(),
          children,
        });
      } else if metadata.is_file() {
        entries.push(ExplorerNode {
          name,
          path: child_path.to_string_lossy().replace('\\', "/"),
          kind: "file".into(),
          children: Vec::new(),
        });
      }
    }

    Ok(entries)
  }

  #[tauri::command]
  pub fn list_workspace(workspace_root: String) -> Result<Vec<ExplorerNode>, String> {
    let root = PathBuf::from(&workspace_root);
    let root_safe = canonicalize_within_root(&root, &root)?;
    collect_children(&root_safe)
  }

  #[tauri::command]
  pub fn read_text_file(workspace_root: String, path: String) -> Result<String, String> {
    let root = PathBuf::from(&workspace_root);
    let safe_path = safe_join(&root, &path)?;

    if !safe_path.is_file() {
      return Err(format!("'{}' is not a readable file.", safe_path.display()));
    }

    let bytes = fs::read(&safe_path)
      .map_err(|err| format!("Unable to read '{}': {}", safe_path.display(), err))?;

    if bytes.iter().any(|byte| *byte == 0) {
      return Err(format!("'{}' is a binary file and cannot be opened as text.", safe_path.display()));
    }

    String::from_utf8(bytes)
      .map_err(|_| format!("'{}' contains invalid UTF-8 and cannot be opened as text.", safe_path.display()))
  }

  #[tauri::command]
  pub fn write_text_file(workspace_root: String, path: String, content: String) -> Result<(), String> {
    let root = PathBuf::from(&workspace_root);
    let safe_path = safe_join(&root, &path)?;

    if safe_path.is_dir() {
      return Err(format!("'{}' is a directory, not a file.", safe_path.display()));
    }

    fs::write(&safe_path, content)
      .map_err(|err| format!("Unable to write '{}': {}", safe_path.display(), err))?;

    Ok(())
  }

  #[tauri::command]
  pub fn create_path(workspace_root: String, parent_path: String, name: String, kind: String) -> Result<String, String> {
    let root = PathBuf::from(&workspace_root);
    let name = name.trim();
    if name.is_empty() {
      return Err("File and folder names cannot be empty.".into());
    }

    let parent = if parent_path.is_empty() || parent_path == "/" {
      root.clone()
    } else {
      safe_join(&root, &parent_path)?
    };

    if !parent.is_dir() {
      return Err(format!("'{}' is not a folder.", parent.display()));
    }

    let final_path = if name.contains(std::path::MAIN_SEPARATOR) || name.contains('/') || name.contains('\\') {
      return Err("File and folder names cannot include path separators.".into());
    }
    else {
      parent.join(name)
    };

    let protected = canonicalize_within_root(&root, &final_path)?;

    if protected.exists() {
      return Err(format!("'{}' already exists.", protected.display()));
    }

    match kind.as_str() {
      "file" => {
        let file = fs::File::create(&protected)
          .map_err(|err| format!("Unable to create file '{}': {}", protected.display(), err))?;
        drop(file);
      }
      "directory" => {
        fs::create_dir(&protected)
          .map_err(|err| format!("Unable to create folder '{}': {}", protected.display(), err))?;
      }
      _ => return Err("Unsupported path kind. Use 'file' or 'directory'.".into()),
    }

    Ok(protected.to_string_lossy().replace('\\', "/"))
  }

  #[tauri::command]
  pub fn rename_path(workspace_root: String, old_path: String, new_name: String) -> Result<String, String> {
    let root = PathBuf::from(&workspace_root);
    let old_safe = safe_join(&root, &old_path)?;
    let trimmed = new_name.trim();

    let root_canonical = fs::canonicalize(&root)
      .map_err(|err| format!("Unable to read workspace root '{}': {}", root.display(), err))?;
    if old_safe == root_canonical {
      return Err("The workspace root cannot be renamed here.".into());
    }

    if trimmed.is_empty() || trimmed.contains(std::path::MAIN_SEPARATOR) || trimmed.contains('/') || trimmed.contains('\\') {
      return Err("Invalid replacement name.".into());
    }

    let parent = old_safe.parent().unwrap_or(&root).to_path_buf();
    let new_path = parent.join(trimmed);

    let protected = canonicalize_within_root(&root, &new_path)?;
    if protected.exists() {
      return Err(format!("'{}' already exists.", protected.display()));
    }

    fs::rename(&old_safe, &protected)
      .map_err(|err| format!("Unable to rename '{}': {}", old_safe.display(), err))?;

    Ok(protected.to_string_lossy().replace('\\', "/"))
  }

  #[tauri::command]
  pub fn delete_path(workspace_root: String, path: String) -> Result<(), String> {
    let root = PathBuf::from(&workspace_root);
    let safe_path = safe_join(&root, &path)?;
    let root_canonical = fs::canonicalize(&root)
      .map_err(|err| format!("Unable to read workspace root '{}': {}", root.display(), err))?;

    if safe_path == root_canonical {
      return Err("The workspace root cannot be deleted here.".into());
    }

    if safe_path.is_dir() {
      fs::remove_dir_all(&safe_path)
        .map_err(|err| format!("Unable to delete folder '{}': {}", safe_path.display(), err))?;
    } else if safe_path.is_file() {
      fs::remove_file(&safe_path)
        .map_err(|err| format!("Unable to delete file '{}': {}", safe_path.display(), err))?;
    } else {
      return Err(format!("'{}' does not exist or is not a supported file system entry.", safe_path.display()));
    }

    Ok(())
  }

  #[cfg(test)]
  mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
      fn new(label: &str) -> Self {
        let unique = SystemTime::now()
          .duration_since(UNIX_EPOCH)
          .expect("system clock should be after the Unix epoch")
          .as_nanos();
        let path = std::env::temp_dir().join(format!("devmate-{label}-{}-{unique}", std::process::id()));
        fs::create_dir(&path).expect("test directory should be created");
        Self(path)
      }
    }

    impl Drop for TestDirectory {
      fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
      }
    }

    #[test]
    fn workspace_file_operations_round_trip() {
      let workspace = TestDirectory::new("workspace-crud");
      let root = workspace.0.to_string_lossy().to_string();
      let created = create_path(root.clone(), root.clone(), "notes.txt".into(), "file".into())
        .expect("file should be created");

      write_text_file(root.clone(), created.clone(), "saved content".into())
        .expect("file should be saved");
      assert_eq!(read_text_file(root.clone(), created.clone()).unwrap(), "saved content");

      let renamed = rename_path(root.clone(), created, "renamed.txt".into())
        .expect("file should be renamed");
      assert_eq!(read_text_file(root.clone(), renamed.clone()).unwrap(), "saved content");
      delete_path(root, renamed).expect("file should be deleted");
    }

    #[test]
    fn workspace_directory_operations_round_trip() {
      let workspace = TestDirectory::new("workspace-directory-crud");
      let root = workspace.0.to_string_lossy().to_string();
      let directory = create_path(root.clone(), root.clone(), "drafts".into(), "directory".into())
        .expect("folder should be created");
      let file = create_path(root.clone(), directory, "note.txt".into(), "file".into())
        .expect("nested file should be created");
      write_text_file(root.clone(), file, "nested content".into()).unwrap();

      let renamed = rename_path(root.clone(), format!("{root}/drafts"), "archive".into())
        .expect("folder should be renamed");
      assert_eq!(read_text_file(root.clone(), format!("{renamed}/note.txt")).unwrap(), "nested content");
      delete_path(root, renamed).expect("folder and nested file should be deleted");
      assert!(!workspace.0.join("archive").exists());
    }

    #[test]
    fn workspace_root_and_outside_paths_are_protected() {
      let workspace = TestDirectory::new("workspace-boundary");
      let outside = TestDirectory::new("outside-boundary");
      let root = workspace.0.to_string_lossy().to_string();
      let outside_file = outside.0.join("secret.txt");
      fs::write(&outside_file, "outside").unwrap();

      assert!(delete_path(root.clone(), root.clone()).is_err());
      assert!(rename_path(root.clone(), root.clone(), "renamed-root".into()).is_err());
      assert!(read_text_file(root, outside_file.to_string_lossy().to_string()).is_err());
      assert!(workspace.0.exists());
      assert!(outside_file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn workspace_listing_does_not_follow_symlinks() {
      use std::os::unix::fs::symlink;

      let workspace = TestDirectory::new("workspace-symlink");
      let outside = TestDirectory::new("outside-symlink");
      fs::write(outside.0.join("private.txt"), "outside").unwrap();
      symlink(&outside.0, workspace.0.join("external-link")).unwrap();

      let entries = list_workspace(workspace.0.to_string_lossy().to_string()).unwrap();
      assert!(entries.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn workspace_operations_reject_symlinks_to_in_root_targets() {
      use std::os::unix::fs::symlink;

      let workspace = TestDirectory::new("workspace-internal-link");
      let root = workspace.0.to_string_lossy().to_string();
      let target = workspace.0.join("target.txt");
      let alias = workspace.0.join("alias.txt");
      fs::write(&target, "preserve target").unwrap();
      symlink(&target, &alias).unwrap();

      assert!(read_text_file(root.clone(), alias.to_string_lossy().to_string()).is_err());
      assert!(write_text_file(root.clone(), alias.to_string_lossy().to_string(), "overwrite".into()).is_err());
      assert!(rename_path(root.clone(), alias.to_string_lossy().to_string(), "renamed.txt".into()).is_err());
      assert!(delete_path(root, alias.to_string_lossy().to_string()).is_err());
      assert_eq!(fs::read_to_string(target).unwrap(), "preserve target");
    }

    #[cfg(unix)]
    #[test]
    fn creating_over_a_dangling_symlink_is_rejected() {
      use std::os::unix::fs::symlink;

      let workspace = TestDirectory::new("workspace-dangling-link");
      let outside = TestDirectory::new("outside-dangling-link");
      let root = workspace.0.to_string_lossy().to_string();
      let target = outside.0.join("created-outside.txt");
      symlink(&target, workspace.0.join("dangling-link")).unwrap();

      assert!(create_path(root.clone(), root, "dangling-link".into(), "file".into()).is_err());
      assert!(!target.exists());
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::list_workspace,
      commands::read_text_file,
      commands::write_text_file,
      commands::create_path,
      commands::rename_path,
      commands::delete_path
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
