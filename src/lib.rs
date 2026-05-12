use std::env;
use std::path::PathBuf;
use zed_extension_api::{self as zed, LanguageServerId, Result, Worktree};

struct BundleSizeExtension {
    esbuild_version: Option<String>,
}

impl BundleSizeExtension {
    /// Resolves the path to `server/dist/index.js` inside the extension's
    /// installation directory.
    ///
    /// Zed runs the extension WASM with `current_dir()` pointing to the
    /// *work* directory (`extensions/work/<id>/`), where npm packages are
    /// installed. The actual extension files (including the bundled server)
    /// live in the sibling *installed* directory (`extensions/installed/<id>/`).
    fn server_path(&self) -> Result<PathBuf> {
        let work_dir = env::current_dir().map_err(|e| e.to_string())?;

        // work_dir = …/extensions/work/<id>
        // server   = …/extensions/installed/<id>/server/dist/index.js
        let ext_name = work_dir
            .file_name()
            .ok_or("cannot determine extension id from work dir")?;

        let server_path = work_dir
            .parent() // …/extensions/work
            .and_then(|p| p.parent()) // …/extensions
            .map(|p| {
                p.join("installed")
                    .join(ext_name)
                    .join("server/dist/index.js")
            })
            .ok_or("cannot derive extension installed dir")?;

        Ok(server_path)
    }
}

impl zed::Extension for BundleSizeExtension {
    fn new() -> Self {
        Self {
            esbuild_version: None,
        }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        _worktree: &Worktree,
    ) -> Result<zed::Command> {
        // Install esbuild into the work dir so it is available at runtime
        // for in-process bundling by the Node.js server.
        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let esbuild_version = zed::npm_package_latest_version("esbuild")?;
        let installed_version = zed::npm_package_installed_version("esbuild")?;

        if installed_version.as_deref() != Some(esbuild_version.as_str()) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            zed::npm_install_package("esbuild", &esbuild_version)?;
        }

        self.esbuild_version = Some(esbuild_version);

        let server_path = self.server_path()?;

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().to_string(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(BundleSizeExtension);
