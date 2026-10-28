//! The real engine: the handshake against the artifact the app ships, skipped — loudly — when the
//! pipeline product is absent, as it is in a plain checkout (P0 §1).

use std::path::Path;

use nekowite_lib::agent_runtime::{
    env_pairs, isolated_profile_env, EngineConnection, EngineLaunch,
};

use crate::support::{start, temp_dir};

#[tokio::test]
async fn installed_agent_answers_through_the_application_transport() {
    let Ok(program) = std::env::var("NEKOWITE_LOCAL_ACP_PROGRAM") else {
        return;
    };
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/local-acp-probe");
    for directory in ["home", "config", "cache", "data"] {
        std::fs::create_dir_all(root.join(directory)).expect("isolated agent directory");
    }
    let launch = EngineLaunch {
        program: program.into(),
        args: std::env::var("NEKOWITE_LOCAL_ACP_ARGUMENT")
            .map(|arg| vec![arg])
            .unwrap_or_default(),
        env: env_pairs([
            (
                "HOME".into(),
                root.join("home").to_string_lossy().into_owned(),
            ),
            (
                "XDG_CONFIG_HOME".into(),
                root.join("config").to_string_lossy().into_owned(),
            ),
            (
                "XDG_CACHE_HOME".into(),
                root.join("cache").to_string_lossy().into_owned(),
            ),
            (
                "XDG_DATA_HOME".into(),
                root.join("data").to_string_lossy().into_owned(),
            ),
        ]),
        ca_bundle: None,
    };
    let (connection, _events) = EngineConnection::connect(&launch)
        .await
        .expect("start local agent");
    let answer = connection
        .initialize(launch.initialize_bound())
        .await
        .expect("local ACP initialize");
    assert_eq!(answer.protocol_version.as_u16(), 1);
    connection.shutdown();
}

// ---------------------------------------------------------------------------
// The real engine
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_real_engine_negotiates_protocol_version_one() {
    // The artifact is a pipeline product and gitignored (P0 §1), so a checkout
    // without it is normal — that is a skip, not a failure. Run
    // `scripts/fetch-opencode-linux.sh` to make this test mean something.
    let binary =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/opencode-x86_64-unknown-linux-gnu");
    if !binary.is_file() {
        eprintln!(
            "SKIP: {} is absent; run scripts/fetch-opencode-linux.sh",
            binary.display()
        );
        return;
    }

    // Its own HOME and XDG roots: plan §10.4 forbids exercising the developer's
    // real OpenCode profile, and the engine writes config and state under those
    // roots as soon as it starts.
    let profile = temp_dir("real-profile");
    let launch = EngineLaunch {
        program: binary,
        args: vec!["acp".to_string()],
        env: env_pairs(isolated_profile_env(&profile)),
        ca_bundle: None,
    };
    let (runtime, _events) = start(&launch).await;

    // Nothing past the handshake: `initialize` costs nothing and needs no
    // credentials, so this stays a test and not a bill.
    let response = runtime
        .initialize()
        .await
        .expect("the real engine initializes");

    assert_eq!(response.protocol_version.as_u16(), 1);
    let info = response.agent_info.expect("agentInfo");
    assert_eq!(info.name, "OpenCode");
    // Not pinned to 1.18.29: the artifact is updated by its own task (T14), and
    // a test that failed on an engine upgrade would be reporting the version
    // bump rather than a broken handshake.
    assert!(
        info.version.starts_with(char::is_numeric),
        "agentInfo.version should look like a version, got {:?}",
        info.version
    );
    runtime.shutdown();
}
