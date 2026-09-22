use std::io::Write;
use std::path::Path;

/// Write beside the destination and atomically replace it, preserving the old file on failure.
#[tauri::command]
pub fn save_scene_file(path: String, text: String) -> Result<(), String> {
    let path = Path::new(&path).canonicalize().map_err(|e| e.to_string())?;
    if path.extension().and_then(|v| v.to_str()) != Some("excalidraw") {
        return Err("只能保存 .excalidraw 文件".into());
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if !value.get("elements").is_some_and(|v| v.is_array()) {
        return Err("无效的绘图文件".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("缺少父目录")?)
        .map_err(|e| e.to_string())?;
    let permissions = std::fs::metadata(&path)
        .map_err(|e| e.to_string())?
        .permissions();
    temporary
        .as_file()
        .set_permissions(permissions)
        .map_err(|e| e.to_string())?;
    temporary
        .write_all(text.as_bytes())
        .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_write_preserves_original_and_valid_write_replaces_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("drawing.excalidraw");
        std::fs::write(&path, "original").unwrap();
        assert!(save_scene_file(path.display().to_string(), "null".into()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        save_scene_file(path.display().to_string(), "{\"elements\":[]}".into()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"elements\":[]}");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
