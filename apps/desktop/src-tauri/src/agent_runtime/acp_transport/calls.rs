//! The calls this host makes over an ACP connection, and the bound each one carries.
//!
//! This is the other half of `acp_transport.rs`, split by what each half has to be true of rather
//! than by size. A connection is a *process* with a lifetime: it is spawned once, it outlives every
//! request, and its handlers must never block the SDK's dispatch loop — that is the parent's rule,
//! and it holds whether or not a single call is ever made. A call is a *request with a deadline*:
//! the SDK has no timeout anywhere in its path, so every one of these carries its own bound and
//! every failure it produces is classified before it leaves. Neither rule can be stated in the
//! other's terms.
//!
//! What the parent owns and this file borrows: [`super::EngineConnection`], whose `connection`
//! field is the SDK's handle and whose `trip` field is the bounded reader's own account of why it
//! stopped — [`trip_reason`] is the caller's half of that note, and it is why a frame that grew
//! past `MAX_FRAME_BYTES` reaches the window as a size fault rather than as a crash.
//!
//! The one call here that is not a thin wrapper is [`EngineConnection::prompt`]: its response is
//! read by `usage::ending` rather than by the SDK's own router, for the two measurements P0 §6.3
//! made of this engine — a `usage` object missing a counter the schema requires, and a `stopReason`
//! word the pinned schema does not enumerate.

use std::path::Path;
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    CancelNotification, CloseSessionRequest, CloseSessionResponse, ContentBlock, InitializeRequest,
    InitializeResponse, ListSessionsRequest, ListSessionsResponse, LoadSessionRequest,
    LoadSessionResponse, NewSessionRequest, NewSessionResponse, PromptRequest,
    SessionConfigValueId, SessionId, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{JsonRpcRequest, UntypedMessage};

use super::super::events::{classify, TransportError};
use super::super::fs_capability;
use super::super::usage::{self, PromptEnding};
use super::EngineConnection;

impl EngineConnection {
    pub fn initialize_bound(&self) -> Duration {
        self.initialize_bound
    }

    /// Negotiates the protocol.
    ///
    /// The version is checked here as well as by the SDK's own guard: a version
    /// this host does not implement must fail as `protocol-incompatible` at the
    /// handshake, or every later call fails in a way that reads as an engine
    /// bug.
    pub async fn initialize(&self, bound: Duration) -> Result<InitializeResponse, TransportError> {
        // The capability is declared here and nowhere else. P0 §7.2 measured the
        // engine sending `fs/write_text_file` even under an empty capability
        // set; advertising it is what makes a *delegated* write one this host
        // performs, through the app's own write path. It is not exclusivity: P0
        // §7's default-configuration probe measured the same engine writing a
        // file through its own tools with zero reverse requests, so what arrives
        // here is a write the engine handed over, not a gate every write must pass.
        let initialize = InitializeRequest::new(ProtocolVersion::V1)
            .client_capabilities(fs_capability::client_capabilities());
        let response = self.request("initialize", initialize, bound).await?;
        if response.protocol_version != ProtocolVersion::V1 {
            return Err(TransportError::ProtocolIncompatible {
                found: response.protocol_version.as_u16(),
            });
        }
        Ok(response)
    }

    /// Opens a session in `cwd`.
    pub async fn new_session(
        &self,
        cwd: &Path,
        bound: Duration,
    ) -> Result<NewSessionResponse, TransportError> {
        self.request(
            "session/new",
            NewSessionRequest::new(cwd.to_path_buf()),
            bound,
        )
        .await
    }

    /// Lists the sessions the engine holds.
    ///
    /// Answered out of the engine's own database, so it costs nothing and reaches no provider —
    /// which is why the scan report could measure it without a credential
    /// (`agent_session_lifecycle_test.rs`, §4.5). Both parameters are optional in the schema and
    /// the engine was measured answering `{}`; `cwd` narrows to one working directory and `cursor`
    /// continues a page the engine cut short.
    pub async fn list_sessions(
        &self,
        cwd: Option<&Path>,
        cursor: Option<&str>,
        bound: Duration,
    ) -> Result<ListSessionsResponse, TransportError> {
        let request = ListSessionsRequest::new()
            .cwd(cwd.map(Path::to_path_buf))
            .cursor(cursor.map(str::to_string));
        self.request("session/list", request, bound).await
    }

    /// Reopens a session the engine still holds.
    ///
    /// The response carries only the session's modes and configuration options — never its
    /// conversation. What a load restores arrives as `session/update` notifications published
    /// *while this call is outstanding*, which is why the caller must have the session registered
    /// before it sends this: a replayed update for an id the host does not hold is dropped by
    /// `runs::forward_update`. Zed's implementation states the same ordering in as many words
    /// ("Register the session before awaiting the RPC so that any `session/update` notifications
    /// that arrive during the call (e.g. history replay during `session/load`) can find the
    /// thread", `zed-main/crates/agent_servers/src/acp.rs:1223-1227`), and the SDK's own load
    /// builder documents the contract (agent-client-protocol 2.1.0 `src/session.rs:79-83`).
    pub async fn load_session(
        &self,
        session_id: SessionId,
        cwd: &Path,
        bound: Duration,
    ) -> Result<LoadSessionResponse, TransportError> {
        let request = LoadSessionRequest::new(session_id, cwd.to_path_buf());
        self.request("session/load", request, bound).await
    }

    /// Frees a session on the engine, cancelling any work it has in flight.
    ///
    /// The schema's own words for the contract: the agent "must cancel any ongoing work related
    /// to the session ... and then free up any resources associated with the session". Removing
    /// the conversation from `session/list` is `session/delete`'s job, which the pinned engine
    /// neither advertises nor implements (`agent_session_lifecycle_test.rs` prints its `-32601`),
    /// so a closed session that is still listed is the two methods meaning what they say.
    pub async fn close_session(
        &self,
        session_id: SessionId,
        bound: Duration,
    ) -> Result<CloseSessionResponse, TransportError> {
        self.request("session/close", CloseSessionRequest::new(session_id), bound)
            .await
    }

    /// Selects one of the engine's own options on a session.
    pub async fn set_config_option(
        &self,
        session_id: SessionId,
        config_id: String,
        value: String,
        bound: Duration,
    ) -> Result<SetSessionConfigOptionResponse, TransportError> {
        // The value is wrapped as the engine's own option id rather than as a
        // bare string, because the option may be a boolean or a group id: the
        // type is what keeps a caller from sending a shape the engine's list
        // never offered.
        let request = SetSessionConfigOptionRequest::new(
            session_id,
            config_id,
            SessionConfigValueId::new(value),
        );
        self.request("session/set_config_option", request, bound)
            .await
    }

    /// Starts a generation. The answer arrives as updates and finally as this
    /// ending, which carries the stop reason and the usage.
    ///
    /// The request is sent untyped — `UntypedMessage` carries the SDK's own
    /// [`PromptRequest`] as its params, so the engine sees the frame it always
    /// saw — and the response is read by [`usage::ending`] rather than by the
    /// SDK's router, for two reasons that are one measurement: `PromptResponse`
    /// holds usage as `Option<Usage>`, `Usage` requires `totalTokens`,
    /// `inputTokens` and `outputTokens` as non-optional `u64`s, and P0 §6.3
    /// measured the engine omitting one of them; and its `stopReason` is the
    /// pinned schema's five variants with no arm for a sixth, which §6.3's
    /// moving protocol surface makes a frame to read rather than to refuse.
    /// Nothing else about the response changes: a frame that reader will not
    /// read fails through `classify` exactly as the SDK's router would have
    /// failed it.
    ///
    /// `prompt` is the whole of what the turn carries, in the order the caller built it: this
    /// layer does not decide what a message is made of, and it does not add a block to one. What
    /// the blocks may legally be is the engine's own report and belongs with the code that reads
    /// it (`super::super::attachments`); what this call owns is the frame and its deadline.
    pub async fn prompt(
        &self,
        session_id: SessionId,
        prompt: Vec<ContentBlock>,
        bound: Duration,
    ) -> Result<PromptEnding, TransportError> {
        let request = UntypedMessage::new("session/prompt", PromptRequest::new(session_id, prompt))
            .map_err(classify)?;
        // The method the request itself carries, so the timeout this call may
        // report names the same call the engine was sent.
        let method = request.method().to_string();
        let raw: serde_json::Value = self.request(&method, request, bound).await?;

        usage::ending(&method, &raw).map_err(classify)
    }

    /// Asks the engine to stop the generation running on a session.
    ///
    /// A notification, not a request: the engine does not answer it, and the
    /// run ends when the prompt call itself returns.
    pub fn cancel(&self, session_id: SessionId) -> Result<(), TransportError> {
        self.connection
            .send_notification(CancelNotification::new(session_id))
            .map_err(classify)
    }

    async fn request<Req>(
        &self,
        method: &str,
        request: Req,
        bound: Duration,
    ) -> Result<Req::Response, TransportError>
    where
        Req: JsonRpcRequest,
        Req::Response: Send,
    {
        let pending = self.connection.send_request(request);
        // The SDK has no timeout of its own, so the bound is applied here. A
        // cancelled `block_task` leaves the request outstanding; the SDK's
        // router discards an answer that arrives for it afterwards.
        match tokio::time::timeout(bound, pending.block_task()).await {
            Ok(Ok(response)) => Ok(response),
            // The bound reports through the closed connection, so its own
            // reason is preferred over whatever the closure looked like.
            //
            // A closed connection is also the one failure the engine's own stderr is
            // attached to (`with_engine_stderr`): this is the path a handshake takes
            // when the engine will not start, and "the connection closed" on its own
            // says nothing about why. The attachment is a no-op for the bound's own
            // reason above, which is a sentence the host wrote rather than one the
            // engine did.
            //
            // It is awaited because attaching waits for the engine's end of stderr to
            // close before it quotes the log: an engine that has just died is a task
            // hop away from having said its last word, and a sentence built before then
            // would carry nothing. Which failure a closure is read as is
            // `failure_of_call`'s, and it is the one place the engine's own end is
            // allowed to correct it.
            Ok(Err(error)) => {
                let error = self
                    .with_engine_stderr(self.failure_of_call(method, error).await)
                    .await;
                Err(error)
            }
            Err(_) => Err(TransportError::Timeout {
                method: method.to_string(),
            }),
        }
    }

    /// What a call that got no answer from the engine is reported as.
    ///
    /// The reason the bounded reader stopped comes first: it is a sentence this host wrote about a
    /// condition this host measured, and the closure's own text says nothing about it.
    ///
    /// What is left is the SDK's account, and there is one failure it cannot give a true one for.
    /// The engine's death ends the transport, which wakes two of the SDK's own actors at once: the
    /// read half reaches EOF and fails every outstanding reply with the reason
    /// [`super::super::events::classify`] recognises, while the write half's send to a process that
    /// is gone fails, which ends the connection *without* failing them. A reply dropped that way
    /// arrives here as the SDK's own internal error — `response to \`initialize\` never received:
    /// oneshot canceled` — and it is not the engine's answer: it is the host's bookkeeping
    /// noticing that no answer will come. [`super::super::process::EngineExit`] carries the race and the
    /// measurement. No answer *plus* an engine that is gone is a
    /// [`TransportError::Disconnected`], which is the arm, and the only arm,
    /// [`super::EngineConnection::with_engine_stderr`] attaches the engine's last words to — so
    /// reading it correctly is the whole of what makes them reach a reader.
    ///
    /// Only a failure the SDK raised on its own behalf is re-read. An answer from the engine is the
    /// engine's own code in its own words, and an engine that answered was there to answer; gating
    /// on that shape is also what keeps a healthy engine's error answer from paying for the wait.
    async fn failure_of_call(
        &self,
        method: &str,
        error: agent_client_protocol::Error,
    ) -> TransportError {
        if let Some(reason) = self.trip_reason() {
            return reason;
        }
        if sdk_reports_its_own_failure(&error) && self.engine_exit.exited().await {
            return TransportError::Disconnected {
                // The SDK's sentence is about a oneshot channel with no sender left, which is a
                // fact about this process rather than about the engine. The host knows the
                // condition, so it says it.
                detail: format!("the engine exited before it answered `{method}`"),
            };
        }
        classify(error)
    }

    /// The bound's own account of why the connection stopped, if it was.
    ///
    /// Without this the caller sees only that the transport closed, which
    /// reads as a crash; the reader is the one component that knows a frame
    /// grew past the limit, so it leaves the reason here on its way out.
    fn trip_reason(&self) -> Option<TransportError> {
        self.trip
            .lock()
            .unwrap()
            .clone()
            .map(|message| TransportError::Engine { message })
    }
}

/// Whether the error is the SDK's own report of a failure rather than an answer from the engine.
///
/// Every failure `agent-client-protocol` 2.1.0 raises on its own behalf is built by its
/// `util::internal_error` (`src/util.rs:61-63`): JSON-RPC's internal-error code, that crate's own
/// literal message, and the reason carried as a **string** in `data` — which is why an undelivered
/// reply reads as `Internal error: "response to \`initialize\` never received: oneshot canceled"`
/// (`src/jsonrpc.rs:5997-6000`, the arm `block_task` takes when its response channel was dropped
/// rather than answered). An answer from the engine carries the engine's own code, message and
/// data — the certificate failure P0 §2.4 measured arrives as `-32603` with its own message in
/// place of this crate's — and the SDK's one *other* local report,
/// `incoming_transport_closed_error` (`src/jsonrpc.rs:3533-3540`), is told apart before this by its
/// `data.reason`, which is an object rather than a string. So the shape says *the SDK could not
/// deliver an answer*, and that is the only case in which the engine's own end decides what the
/// failure was.
fn sdk_reports_its_own_failure(error: &agent_client_protocol::Error) -> bool {
    let sdk_internal = agent_client_protocol::Error::internal_error();
    error.code == sdk_internal.code
        && error.message == sdk_internal.message
        && error
            .data
            .as_ref()
            .is_some_and(serde_json::Value::is_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape that decides whether the engine's own end has anything to say about a failure.
    /// Pinned because it is the whole of the gate: the SDK's dropped reply — the one the flake was
    /// measured on — must be a candidate, and an answer from the engine must never be, or a live
    /// engine's own words would be re-read as its death.
    #[test]
    fn only_the_sdks_own_failure_is_read_against_the_engines_end() {
        // The measured sentence, verbatim, in the shape `block_task` builds it.
        let dropped = agent_client_protocol::Error::internal_error()
            .data("response to `initialize` never received: oneshot canceled");
        assert!(
            sdk_reports_its_own_failure(&dropped),
            "a reply the SDK dropped is what the engine's end is consulted for: {dropped}"
        );

        // An answer from the engine: JSON-RPC's internal-error code is not enough on its own,
        // because P0 §2.4's measured certificate failure carries exactly that code and an
        // untouched message beside it.
        let answer = agent_client_protocol::Error::new(
            -32603,
            "Internal error: unknown certificate verification error",
        );
        assert!(
            !sdk_reports_its_own_failure(&answer),
            "the engine's own answer is never re-read as a disconnection: {answer}"
        );

        // The SDK's other local report, which `classify` already reads as a disconnection by its
        // own reason: a shape this gate must leave alone rather than claim.
        let closed = agent_client_protocol::Error::internal_error().data(serde_json::json!({
            "reason": "incoming_transport_closed",
            "method": "initialize",
        }));
        assert!(
            !sdk_reports_its_own_failure(&closed),
            "the marked disconnection is classified by its reason, not by this: {closed}"
        );
    }
}
