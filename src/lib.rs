use std::env;
use zed_extension_api::{self as zed, LanguageServerId, Result, Worktree};

struct BundleSizeExtension {
    esbuild_version: Option<String>,
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
        // Install esbuild (used at runtime by the server for bundling)
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

        let server_path = env::current_dir()
            .map_err(|e| e.to_string())?
            .join("server/dist/index.js");

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
