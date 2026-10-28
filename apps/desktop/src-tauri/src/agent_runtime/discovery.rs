//! ACP presets and read-only discovery of their Linux launch dependencies.
//!
//! The closed catalog is always returned, including presets that are not currently installed. A
//! PATH can contain arbitrary executables, so the scan only checks known launch dependencies and
//! never executes them; adding a preset remains an explicit registry action.

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
struct KnownAgent {
    id: &'static str,
    display_name: &'static str,
    launcher: &'static str,
    required_commands: &'static [&'static str],
    adapter_id: &'static str,
    args: &'static [&'static str],
}

const KNOWN_AGENTS: &[KnownAgent] = &[
    KnownAgent {
        id: "opencode",
        display_name: "OpenCode",
        launcher: "opencode",
        required_commands: &["opencode"],
        adapter_id: "opencode",
        args: &["acp"],
    },
    KnownAgent {
        id: "claude-acp",
        display_name: "Claude Code ACP",
        launcher: "npx",
        required_commands: &["npx", "claude"],
        adapter_id: "generic-acp",
        args: &["--yes", "@agentclientprotocol/claude-agent-acp"],
    },
    KnownAgent {
        id: "codex-acp",
        display_name: "Codex ACP",
        launcher: "npx",
        required_commands: &["npx"],
        adapter_id: "generic-acp",
        args: &["--yes", "@agentclientprotocol/codex-acp"],
    },
    KnownAgent {
        id: "gemini",
        display_name: "Gemini CLI",
        launcher: "gemini",
        required_commands: &["gemini"],
        adapter_id: "generic-acp",
        args: &["--experimental-acp"],
    },
    KnownAgent {
        id: "qwen",
        display_name: "Qwen Code",
        launcher: "qwen",
        required_commands: &["qwen"],
        adapter_id: "generic-acp",
        args: &["--acp"],
    },
    KnownAgent {
        id: "cursor-agent",
        display_name: "Cursor Agent ACP",
        launcher: "cursor-agent",
        required_commands: &["cursor-agent"],
        adapter_id: "generic-acp",
        args: &["--acp"],
    },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryCandidate {
    pub agent_id: String,
    pub display_name: String,
    pub command: String,
    pub program: String,
    pub args: Vec<String>,
    pub available: bool,
    pub adapter_id: String,
}

pub fn discover_known_agents(path_var: Option<&str>) -> Vec<DiscoveryCandidate> {
    discover_in_dirs(&linux_search_dirs(
        path_var,
        env::var_os("HOME").map(PathBuf::from),
    ))
}

pub(crate) fn linux_search_dirs(path_var: Option<&str>, home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut search_dirs = Vec::new();
    let mut seen = BTreeSet::new();
    let mut add = |dir: PathBuf| {
        if dir.is_absolute() && env::join_paths([&dir]).is_ok() && seen.insert(dir.clone()) {
            search_dirs.push(dir);
        }
    };
    if let Some(path) = path_var {
        for dir in env::split_paths(path) {
            if !dir.as_os_str().is_empty() {
                add(dir);
            }
        }
    }
    // GUI launchers often receive a reduced PATH. Include the standard per-user Linux bin
    // locations so discovery behaves the same from a desktop file and from a shell.
    if let Some(home) = home {
        for relative in [
            ".local/bin",
            ".local/share/pnpm",
            ".npm-global/bin",
            ".cargo/bin",
            ".bun/bin",
        ] {
            add(home.join(relative));
        }
    }
    add(PathBuf::from("/snap/bin"));
    for dir in ["/usr/local/bin", "/usr/bin", "/bin"] {
        add(PathBuf::from(dir));
    }

    search_dirs
}

fn discover_in_dirs(search_dirs: &[PathBuf]) -> Vec<DiscoveryCandidate> {
    KNOWN_AGENTS
        .iter()
        .map(|known| {
            let commands: BTreeMap<_, _> = known
                .required_commands
                .iter()
                .filter_map(|command| {
                    find_program(&search_dirs, command).map(|path| (*command, path))
                })
                .collect();
            let available = commands.len() == known.required_commands.len();
            let program = commands
                .get(known.launcher)
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_default();
            DiscoveryCandidate {
                agent_id: known.id.to_string(),
                display_name: known.display_name.to_string(),
                command: known.launcher.to_string(),
                program,
                args: known.args.iter().map(|arg| (*arg).to_string()).collect(),
                available,
                adapter_id: known.adapter_id.to_string(),
            }
        })
        .collect()
}

fn find_program(search_dirs: &[PathBuf], command: &str) -> Option<PathBuf> {
    search_dirs
        .iter()
        .map(|directory| directory.join(command))
        .find(|path| is_executable(path))
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::discover_in_dirs;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn search_path_preserves_shell_precedence_and_appends_gui_locations() {
        let dirs = super::linux_search_dirs(
            Some("/z/bin:/a/bin:/z/bin"),
            Some(PathBuf::from("/home/test")),
        );
        assert_eq!(
            &dirs[..2],
            &[PathBuf::from("/z/bin"), PathBuf::from("/a/bin")]
        );
        assert!(dirs.contains(&PathBuf::from("/home/test/.local/bin")));
        assert_eq!(
            dirs.iter()
                .filter(|dir| **dir == PathBuf::from("/z/bin"))
                .count(),
            1
        );
        let invalid_home = super::linux_search_dirs(None, Some(PathBuf::from("/home/a:b")));
        assert!(std::env::join_paths(invalid_home).is_ok());
    }

    #[test]
    fn finds_only_known_executables_and_deduplicates_path() {
        let root = std::env::temp_dir().join(format!("nekowite-discovery-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("mkdir");
        for command in ["codex", "npx"] {
            let program = root.join(command);
            fs::write(&program, "#!/bin/sh\n").expect("write");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = fs::metadata(&program).expect("metadata").permissions();
                permissions.set_mode(0o755);
                fs::set_permissions(&program, permissions).expect("chmod");
            }
        }
        let found = discover_in_dirs(&[root.clone()]);
        let codex_matches: Vec<_> = found
            .iter()
            .filter(|candidate| candidate.agent_id == "codex-acp")
            .collect();
        assert_eq!(codex_matches.len(), 1);
        assert!(codex_matches[0].available);
        assert_eq!(
            codex_matches[0].args,
            ["--yes", "@agentclientprotocol/codex-acp"]
        );
        assert!(found
            .iter()
            .any(|candidate| candidate.agent_id == "claude-acp" && !candidate.available));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_bridge_does_not_require_a_separately_installed_codex_command() {
        let root = std::env::temp_dir().join(format!(
            "nekowite-discovery-codex-only-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("mkdir");
        let launcher = root.join("npx");
        fs::write(&launcher, "#!/bin/sh\n").expect("write");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&launcher).expect("metadata").permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&launcher, permissions).expect("chmod");
        }

        let candidate = discover_in_dirs(&[root.clone()])
            .into_iter()
            .find(|candidate| candidate.agent_id == "codex-acp")
            .expect("Codex preset");
        assert!(candidate.available);
        assert_eq!(candidate.args, ["--yes", "@agentclientprotocol/codex-acp"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_launcher_is_reported_without_failing_the_scan() {
        let root =
            std::env::temp_dir().join(format!("nekowite-discovery-empty-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("mkdir");
        let found = discover_in_dirs(&[root.clone()]);
        assert_eq!(found.len(), 6);
        assert!(found.iter().all(|candidate| !candidate.available));
        let _ = fs::remove_dir_all(root);
    }
}
