//! What one launch *is*: the program, its arguments, the credential-bearing environment, and the CA
//! bundle this app injects into it.
//!
//! A module of its own rather than a section of [`super`], and the split is by what makes each part
//! change. This moves when the *contents* of a launch do: which program a registration pins (T14's
//! packaging decision), which variables carry a credential and how one is allowed to reach the
//! child, or the certificate policy of P0 §2.4. Nothing here reads a pipe, sends a signal or looks
//! at a process table, so none of the reasons `super`'s other children change can reach it.
//!
//! The one thing to keep in mind while reading it: [`EngineLaunch::env`] is a `Vec<(String, Secret)>`
//! rather than a `Vec<(String, String)>`, and that is a fix rather than a style — the field's own
//! doc carries what T3a found and what T12 refused to do about it.

use std::path::PathBuf;
use std::time::Duration;

use agent_client_protocol::AcpAgentConfig;

use super::super::secret::Secret;

/// The CA bundle handed to the engine through `NODE_EXTRA_CA_CERTS`.
///
/// P0 §2.4: without it every prompt against a host whose chain is complete but
/// absent from the engine's bundled store fails as `unknown certificate
/// verification error` — a sentence that names neither the host nor the fix.
/// The value is the path the measurement used, which is the Debian/Arch
/// spelling of the system bundle; a distribution that keeps its store
/// elsewhere can override it through [`EngineLaunch::ca_bundle`].
pub const SYSTEM_CA_BUNDLE: &str = "/etc/ssl/certs/ca-certificates.crt";
const LOCAL_INITIALIZE_BOUND: Duration = Duration::from_secs(20);
const PACKAGE_LAUNCH_INITIALIZE_BOUND: Duration = Duration::from_secs(120);

/// How to start one engine.
///
/// The caller owns `program`: the bundled artifact's path is a packaging
/// decision (T14), and the tests pass a fixture script instead.
///
/// **`env` holds [`Secret`]s, and that is the whole of what makes this struct
/// safe to derive `Debug` on.** T3a found the derived impl printing `env`
/// verbatim while the field was a `Vec<(String, String)>`; T12 then refused to
/// inject a provider key into a vector any `{:?}` could print, which left the
/// plan's credential flow unimplemented. The fix is the field's type rather
/// than an impl here: a value that cannot be printed is unprintable in *every*
/// struct that holds one — this one, a future wrapper, a `Vec` of launches in a
/// diagnostic — while a hand-written `Debug` would only be a promise about this
/// one. `ca_bundle` and the arguments stay plain: neither is a credential, and
/// P0 §3 keeps credentials out of `argv` entirely.
#[derive(Debug, Clone, Default)]
pub struct EngineLaunch {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// Profile roots and credentials travel in the environment, never in
    /// `argv` (P0 §3): `/proc/<pid>/cmdline` is world-readable, so an API key
    /// on a command line is a key disclosed to every process on the machine.
    pub env: Vec<(String, Secret)>,
    /// A CA bundle to hand the engine; `None` means "the system one, when it is
    /// there".
    pub ca_bundle: Option<PathBuf>,
}

impl EngineLaunch {
    /// Package launchers may need to download an ACP bridge before they can answer initialize.
    pub fn initialize_bound(&self) -> Duration {
        let launcher = self.program.file_name().and_then(|name| name.to_str());
        if matches!(launcher, Some("npx" | "npm" | "pnpm" | "bunx" | "uvx")) {
            PACKAGE_LAUNCH_INITIALIZE_BOUND
        } else {
            LOCAL_INITIALIZE_BOUND
        }
    }

    /// The SDK's launch description, with the CA variable resolved.
    ///
    /// This is one of the places the text itself has to exist — the SDK hands
    /// it to `execve`'s child environment — so it calls [`Secret::expose`] by
    /// name rather than the field being printable.
    pub fn agent_config(&self) -> AcpAgentConfig {
        let mut config = AcpAgentConfig::new(&self.program).args(self.args.clone());
        config = config.envs(
            self.env
                .iter()
                .map(|(name, value)| (name.clone(), value.expose().to_string())),
        );
        if let Some(bundle) = self.resolve_ca_bundle() {
            config = config.env("NODE_EXTRA_CA_CERTS", bundle.to_string_lossy().into_owned());
        }
        config
    }

    /// The CA bundle to inject, or `None` to leave the environment as it is.
    fn resolve_ca_bundle(&self) -> Option<PathBuf> {
        // An explicit override wins, including over an inherited variable: the
        // caller naming a bundle has a reason to.
        if let Some(explicit) = &self.ca_bundle {
            return Some(explicit.clone());
        }
        // An inherited `NODE_EXTRA_CA_CERTS` is a deliberate environment — a
        // corporate bundle, a test harness, a distribution that patches the
        // default — and is exactly the case the variable exists to serve, so
        // it is left alone.
        if std::env::var_os("NODE_EXTRA_CA_CERTS").is_some() {
            return None;
        }
        let system = PathBuf::from(SYSTEM_CA_BUNDLE);
        // A path the engine cannot read is worse than no variable at all: Node
        // warns and ignores it, and the user is left with the opaque TLS
        // failure this is here to prevent. A distribution without a system
        // bundle gets none, and the certificate failure is classified instead
        // (see `acp_transport::certificate_failure`).
        system.is_file().then_some(system)
    }
}

/// Plain pairs as launch environment entries.
///
/// The one conversion in the crate from `String` values into [`EngineLaunch::env`], and it only
/// ever moves a value *into* the protector: a caller that has strings is a caller that holds no
/// credential type (a probe launch, a test fixture, the profile roots), and what it produces cannot
/// be printed afterwards — so the conversion cannot be the step a credential escapes through.
pub fn env_pairs(pairs: impl IntoIterator<Item = (String, String)>) -> Vec<(String, Secret)> {
    pairs
        .into_iter()
        .map(|(name, value)| (name, Secret::new(value)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{EngineLaunch, LOCAL_INITIALIZE_BOUND, PACKAGE_LAUNCH_INITIALIZE_BOUND};
    use std::path::PathBuf;

    #[test]
    fn package_managers_get_download_time_but_native_engines_keep_short_handshake_bound() {
        let package_launch = EngineLaunch {
            program: PathBuf::from("/usr/bin/npx"),
            ..EngineLaunch::default()
        };
        let native_launch = EngineLaunch {
            program: PathBuf::from("/usr/bin/opencode"),
            ..EngineLaunch::default()
        };

        assert_eq!(
            package_launch.initialize_bound(),
            PACKAGE_LAUNCH_INITIALIZE_BOUND
        );
        assert_eq!(native_launch.initialize_bound(), LOCAL_INITIALIZE_BOUND);
    }
}
