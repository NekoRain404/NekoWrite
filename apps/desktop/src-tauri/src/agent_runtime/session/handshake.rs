//! §3.4's first negotiation: the handshake, once per incarnation and before any session.
//!
//! **Why it is a file of its own.** It was a section of [`super`], which passed the 600-line budget
//! `docs/dev.md:286` puts on a business source file, and the criterion that section states is the
//! number of reasons a file changes rather than its length. This module moves when the *negotiation
//! rule* moves: what ACP requires to be first on a connection, what this host keeps from the answer,
//! or who may read it. The parent moves when the host's own table of sessions does — and this is
//! deliberately not per session: one process answers the handshake once and every session on that
//! process shares the answer.
//!
//! The bound on the call stays with the other two bounds in [`super`], because the three are read
//! against each other (`LOAD_BOUND`'s own doc argues from `CONTROL_BOUND`).

use super::super::capabilities::Handshake;
use super::super::events::TransportError;
use super::AgentRuntime;
use super::SessionError;

impl AgentRuntime {
    /// Negotiates the protocol and returns the engine's answer.
    ///
    /// The answer is also this incarnation's capability evidence: §3.4's row makes the handshake
    /// the first of the two negotiations that decide what is available at runtime, so what it
    /// reported is kept here rather than dropped by a caller that only wanted the version.
    pub async fn initialize(
        &self,
    ) -> Result<agent_client_protocol::schema::v1::InitializeResponse, TransportError> {
        let response = self
            .connection
            .initialize(self.connection.initialize_bound())
            .await?;
        *self.handshake.lock().unwrap() = Some(Handshake::of(&response));
        Ok(response)
    }

    /// The handshake this incarnation read, if it has read one.
    ///
    /// **Per incarnation, not per session**, which is the fact a caller with no session needs:
    /// ACP makes `initialize` a connection's first request, so one process answers it once and
    /// every session on that process shares the answer. [`Self::capabilities`] reads the same
    /// value, one session at a time, because a session's *other* facts (its option list, its
    /// published command list) are per session; this accessor is for the half that is not.
    ///
    /// A clone rather than a reference: the caller is the settings IPC, which runs on another task
    /// and must not hold a lock on this runtime while it renders. The value is bounded by the same
    /// rule §3.4 gives the capability report — it belongs to a live incarnation — and a caller that
    /// has the instance is the caller that has the incarnation.
    pub fn handshake(&self) -> Option<Handshake> {
        self.handshake.lock().unwrap().clone()
    }

    /// The handshake, once per incarnation, before the first session.
    ///
    /// ACP's own rule, and the SDK's agent side enforces it in as many words: a connection's first
    /// request is `initialize` ("first ACP request must be initialize"). §3.4's capability row is
    /// where that matters to this app — the two negotiations decide what works, so no session is
    /// opened before the first of them has been read.
    ///
    /// Idempotent by the fact rather than by a counter: once the answer is kept, a second caller
    /// gets the first caller's result instead of a second `initialize` on one connection. The lock
    /// is held across the await on purpose — it is what makes two sessions opened at once share
    /// one handshake rather than race two.
    pub(super) async fn negotiate(&self) -> Result<(), SessionError> {
        let _one_at_a_time = self.negotiating.lock().await;
        if self.handshake.lock().unwrap().is_some() {
            return Ok(());
        }
        self.initialize().await.map_err(SessionError::Transport)?;
        Ok(())
    }
}
