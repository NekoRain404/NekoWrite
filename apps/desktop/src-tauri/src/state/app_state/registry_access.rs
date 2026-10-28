//! How this app's agent definitions are reached and changed: the shared handle a reader takes, the
//! one path that gets `&mut`, and the lazy build behind both.
//!
//! A module of its own because the question is one and so is its reason to change — §3.4.7's rule
//! that a definition may not be edited while a start is awaiting on it. That rule is the whole of
//! [`edit_registry`]'s structure and the reason the registry is an `Arc`; the slots that hold it
//! stay in [`super::agent`], where their own docs describe them.

use std::path::Path;
use std::sync::Arc;

use crate::agent_runtime::discovery::{discover_known_agents, DiscoveryCandidate};
use crate::agent_runtime::registry::persistence::RegistryStorage;
use crate::agent_runtime::registry::AgentRegistry;
use crate::agent_runtime::registry::{AgentRegistration, EnvPolicy, InstallSource};

use super::agent::AgentRuntimeState;
use super::launch::{executable_dir, program_to_launch_or_none};

/// The definitions this app knows, for a reader that only looks — the settings surface's read.
///
/// A share rather than a borrow, because the command that asks runs on another task and a start may
/// be in flight beside it. What it deliberately is *not* is a mutation path: a change goes through
/// [`edit_registry`], which is the only way to get `&mut`, so no caller can edit a definition while
/// a start is awaiting on it (§3.4.7).
pub fn registry_of(
    state: &AgentRuntimeState,
    managed: &Path,
) -> Result<Arc<AgentRegistry>, String> {
    registry_for(state, managed)
}

/// Applies a change to the definitions — register, enable, disable — and answers
/// what the change produced.
///
/// The refusal grammar belongs to the caller: `change` returns its own value, so
/// "the backend said no" is data inside the answer while an `Err` from here means
/// the change *never ran* — the two failure channels T13a's settings surface
/// keeps apart, expressed as two types instead of two conventions.
///
/// **Why the value is taken out and put back.** The registry is stored as an
/// `Arc` because a start awaits while holding it (see [`AgentRuntimeState`]), and a mutation
/// needs `&mut`. `Arc::try_unwrap` succeeds exactly when no start is in flight,
/// so the `Err` arm below is not a lock timeout — it is §3.4.7's rule, seen from
/// the other side: a definition may not be edited while an engine is being
/// started from it. The slot is held for the whole operation, so nothing can
/// observe it empty, and a value that came back out of `try_unwrap` is put back
/// unchanged.
pub fn edit_registry<T>(
    state: &AgentRuntimeState,
    managed: &Path,
    change: impl FnOnce(&mut AgentRegistry) -> T,
) -> Result<T, String> {
    let mut slot = state
        .registry
        .lock()
        .map_err(|_| "the agent registry state was poisoned by a panic".to_string())?;
    let registry = match slot.take() {
        Some(registry) => registry,
        // Not built yet: this is the first thing to ask for it, and the build is the same one a
        // start would have done — a settings page that could not read before a session started
        // would be a page that only worked in one order.
        None => Arc::new(load_registry(managed)?),
    };
    match Arc::try_unwrap(registry) {
        Ok(mut owned) => {
            let answer = owned.edit_persisted(&RegistryFile(managed), change);
            *slot = Some(Arc::new(owned));
            answer
        }
        Err(shared) => {
            // An engine start is in flight and holds a share of this registry. Reported as a
            // failure of *this call* rather than as a refusal, because the request was never
            // considered — and left in the slot exactly as it was.
            *slot = Some(shared);
            Err(
                "an engine is being started, so its registration cannot be changed right now; \
                 try again in a moment"
                    .to_string(),
            )
        }
    }
}

/// This app's agent definitions, built on first use.
/// `pub(super)` rather than private because the start path in [`super::agent`] reaches this too —
/// it is the build [`registry_of`] shares rather than a second one — and `super` is the narrowest
/// scope that holds both readers.
pub(super) fn registry_for(
    state: &AgentRuntimeState,
    managed: &Path,
) -> Result<Arc<AgentRegistry>, String> {
    let mut slot = state
        .registry
        .lock()
        .map_err(|_| "the agent registry state was poisoned by a panic".to_string())?;
    if let Some(registry) = slot.as_ref() {
        return Ok(Arc::clone(registry));
    }
    let registry = Arc::new(load_registry(managed)?);
    *slot = Some(Arc::clone(&registry));
    Ok(registry)
}

fn load_registry(managed: &Path) -> Result<AgentRegistry, String> {
    let storage = RegistryFile(managed);
    let seed_needed = AgentRegistry::needs_preset_seed(&storage)?;
    let mut registry = match program_to_launch_or_none(managed, &executable_dir())? {
        Some(program) => AgentRegistry::with_bundled(program),
        None => AgentRegistry::without_bundled(),
    };
    registry.load_persisted(&storage)?;
    // Persist the first-run set, including an empty set, so a deliberate later deletion stays
    // deleted. Existing registrations are never overwritten by auto-discovery.
    if seed_needed {
        seed_registry(
            &mut registry,
            &storage,
            discover_known_agents(std::env::var("PATH").ok().as_deref()),
        )?;
    }
    Ok(registry)
}

fn seed_registry(
    registry: &mut AgentRegistry,
    storage: &dyn RegistryStorage,
    candidates: Vec<DiscoveryCandidate>,
) -> Result<(), String> {
    for candidate in candidates
        .into_iter()
        .filter(|candidate| candidate.available)
    {
        if registry.get(&candidate.agent_id).is_some() {
            continue;
        }
        let registration = AgentRegistration {
            agent_id: candidate.agent_id,
            display_name: candidate.display_name,
            program: candidate.program.into(),
            args: candidate.args,
            source: InstallSource::External,
            env: EnvPolicy::UserEnvironment,
            env_extra: Vec::new(),
            enabled: true,
            adapter_id: candidate.adapter_id,
            reported_version: None,
        };
        registry
            .register(registration)
            .map_err(|error| format!("cannot add discovered ACP preset: {error:?}"))?;
    }
    if registry.default_agent_id() == "opencode" && registry.get("opencode").is_none() {
        let first_available = registry
            .registrations()
            .filter(|registration| registration.enabled)
            .min_by_key(|registration| {
                // Local ACP executables can answer immediately. An npx bridge may need to
                // download its package before it can even receive initialize.
                (
                    registration
                        .program
                        .file_name()
                        .is_some_and(|name| name == "npx"),
                    registration.agent_id.as_str(),
                )
            })
            .map(|registration| registration.agent_id.clone());
        if let Some(first_available) = first_available {
            registry.set_default_if_unregistered(&first_available);
        }
    }
    storage.write(&registry.persisted_document()?)?;
    Ok(())
}

struct RegistryFile<'a>(&'a Path);

impl RegistryStorage for RegistryFile<'_> {
    fn read(&self) -> Result<Option<String>, String> {
        match std::fs::read_to_string(self.0.join("agent-registry.json")) {
            Ok(document) => Ok(Some(document)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("cannot read agent registry: {error}")),
        }
    }

    fn write(&self, document: &str) -> Result<(), String> {
        let path = self.0.join("agent-registry.json");
        let _guard = crate::storage::atomic_write::write_lock()
            .lock()
            .map_err(|_| "the storage write lock was poisoned".to_string())?;
        match crate::storage::atomic_write::atomic_write(&path, document) {
            Ok(()) => Ok(()),
            Err(error) => {
                // The shared writer can fail its directory fsync *after* rename committed.
                // Keep memory aligned with that committed file instead of claiming rollback.
                if std::fs::read_to_string(&path).ok().as_deref() == Some(document) {
                    eprintln!("nekowite: registry committed but directory sync failed: {error}");
                    Ok(())
                } else {
                    Err(error)
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryStorage(Mutex<Option<String>>);

    impl RegistryStorage for MemoryStorage {
        fn read(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }

        fn write(&self, document: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(document.to_string());
            Ok(())
        }
    }

    #[test]
    fn first_run_presets_installed_agents_and_keeps_deletions_across_restart() {
        let storage = MemoryStorage::default();
        let mut registry = AgentRegistry::without_bundled();
        let candidate = DiscoveryCandidate {
            agent_id: "codex-acp".into(),
            display_name: "Codex ACP".into(),
            command: "npx".into(),
            program: "/usr/bin/npx".into(),
            args: vec!["--yes".into(), "@agentclientprotocol/codex-acp".into()],
            available: true,
            adapter_id: "generic-acp".into(),
        };
        seed_registry(&mut registry, &storage, vec![candidate]).unwrap();
        assert!(registry.get("codex-acp").is_some());
        assert_eq!(registry.default_agent_id(), "codex-acp");
        let second = AgentRegistration {
            agent_id: "claude-acp".into(),
            display_name: "Claude Code ACP".into(),
            program: "/usr/bin/npx".into(),
            args: vec![
                "--yes".into(),
                "@agentclientprotocol/claude-agent-acp".into(),
            ],
            source: InstallSource::External,
            env: EnvPolicy::UserEnvironment,
            env_extra: Vec::new(),
            enabled: true,
            adapter_id: "generic-acp".into(),
            reported_version: None,
        };
        registry.register(second).unwrap();
        storage
            .write(&registry.persisted_document().unwrap())
            .unwrap();
        let mut restarted = AgentRegistry::without_bundled();
        restarted.load_persisted(&storage).unwrap();
        assert!(restarted.get("codex-acp").is_some());
        assert_eq!(restarted.default_agent_id(), "codex-acp");
        restarted
            .edit_persisted(&storage, |registry| registry.remove("codex-acp"))
            .unwrap()
            .unwrap();
        let mut after_delete = AgentRegistry::without_bundled();
        after_delete.load_persisted(&storage).unwrap();
        assert!(after_delete.get("codex-acp").is_none());
        assert_eq!(after_delete.default_agent_id(), "claude-acp");
        after_delete
            .edit_persisted(&storage, |registry| registry.remove("claude-acp"))
            .unwrap()
            .unwrap();
        let mut after_last_delete = AgentRegistry::without_bundled();
        after_last_delete.load_persisted(&storage).unwrap();
        assert!(after_last_delete.default_agent_id().is_empty());
        assert!(storage.read().unwrap().is_some());
    }

    #[test]
    fn first_run_prefers_native_acp_over_a_bridge_that_may_download() {
        let storage = MemoryStorage::default();
        let mut registry = AgentRegistry::without_bundled();
        let candidates = [
            (
                "claude-acp",
                "npx",
                vec!["--yes", "@agentclientprotocol/claude-agent-acp"],
            ),
            ("qwen", "qwen", vec!["--acp"]),
        ]
        .into_iter()
        .map(|(id, command, args)| DiscoveryCandidate {
            agent_id: id.into(),
            display_name: id.into(),
            command: command.into(),
            program: format!("/usr/bin/{command}"),
            args: args.into_iter().map(str::to_string).collect(),
            available: true,
            adapter_id: "generic-acp".into(),
        })
        .collect();
        seed_registry(&mut registry, &storage, candidates).unwrap();
        assert_eq!(registry.default_agent_id(), "qwen");
    }

    #[test]
    fn existing_registry_receives_presets_once_without_overwriting_user_entries() {
        let storage = MemoryStorage(Mutex::new(Some(
            r#"{"version":1,"registrations":[{"agentId":"codex-acp","displayName":"Custom Codex","program":"/opt/my-codex","args":["acp"],"enabled":true,"adapterId":"generic-acp"}],"profileOwners":{}}"#.into(),
        )));
        assert!(AgentRegistry::needs_preset_seed(&storage).unwrap());
        let mut registry = AgentRegistry::without_bundled();
        registry.load_persisted(&storage).unwrap();
        seed_registry(
            &mut registry,
            &storage,
            vec![DiscoveryCandidate {
                agent_id: "codex-acp".into(),
                display_name: "Codex ACP".into(),
                command: "npx".into(),
                program: "/usr/bin/npx".into(),
                args: vec!["--yes".into(), "@agentclientprotocol/codex-acp".into()],
                available: true,
                adapter_id: "generic-acp".into(),
            }],
        )
        .unwrap();
        assert_eq!(
            registry.get("codex-acp").unwrap().program,
            Path::new("/opt/my-codex")
        );
        assert!(!AgentRegistry::needs_preset_seed(&storage).unwrap());
    }
}
