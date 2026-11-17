# Codex chat integration

The StudyBuddy conversation and new-task composer use a native React port of the
Codex extension UI. The source work was recovered from DSH session
`session-71463d69-44fa-466e-9106-89fb923f5409`, then corrected against the real
`OpenAI.chatgpt 26.51111.21308` extension running in an isolated VS Code instance.
See [the reference record](codex-chat-reference.md) for version hashes, genuine
screenshots, measured geometry and the limits of that fixture.

The conversation uses the extension's spacing, typography, message bubbles,
composer, navigation, history popup and model controls. The footer opens an
effort slider; its model link opens a model list. `/model` opens recent complete
configurations, while `/reasoning` opens effort choices. Slash submenus filter
through the composer, preserve `/` on Escape and consume it only on selection.
Switching agents preserves each agent's supported model and effort preferences.
The permission menu retains each provider's actual sandbox and approval meaning.
`/fast` switches the service tier only when the selected model supports it.
`/init` checks the current execution directory for any existing `AGENTS.md`
entry, including ignored files and symlinks. If one exists, it displays the
extension's skip notice. Otherwise it submits the native initialization prompt
through the normal task/message flow, retaining its retry identity. This is a
preflight check, not a lock against another process creating the file later.

The composer uses ProseMirror for atomic file and folder references. `@` searches
the current project or task worktree; choosing a result inserts the extension's
inline label and glyph. The submitted text contains a Markdown link, matching
the captured native protocol. Reference spans survive queue edits, clipboard
round trips and draft recovery. The host validates paths and spans again before
dispatch, including symlinks and files removed after selection. New-task drafts
belong to their project, so switching projects cannot retarget a reference.

`/status` opens a persistent card with the native conversation ID and reported
rate limits. The context ring separately shows measured token usage. `/compact`
uses Codex's native `thread/compact/start` protocol. Acknowledgment, item completion
and turn completion are tracked separately; uncertain results can be checked
without submitting a second request. Unsupported providers do not expose the
native compaction command.

`/mcp` loads a read-only status menu from Codex, including pagination, configured
enabled state and authentication status. Only public status fields reach the
browser; server commands, URLs, environment values, tokens and tool schemas stay
on the host. The menu retains `/` on Escape and never sends a chat message.

Codex approval requests replace the composer with the extension's approval card.
The original draft stays intact. Command, file and permission cards expose only
decisions supported by the pending native request: one-time approval, applicable
conversation scope, or an offered command/network rule. The server constructs
the native response from the saved offer instead of accepting new grants from
the browser. Scoped menus, command expansion, file disclosure, keyboard handling,
failure retry and duplicate-submit protection have deterministic browser tests.

Messages sent while a task works appear in an editable queue above the composer.
The queue supports preview, edit, remove and resume. Stop preserves queued
messages and pauses their dispatch. Editing holds a server lease, retains attached
files and review instructions, and restores the previous composer draft after
saving or cancelling. If a restart releases the lease, both the edit and previous
draft remain recoverable. For Codex, Steer delivers a selected message to the
current native turn. Unconfirmed delivery must be checked before retrying, so a
transport timeout cannot silently send the same message twice. Notes requesting
alternative edits retain their own queued turn because their review result
belongs to that turn.

Image messages use standalone thumbnails and a native modal preview with zoom,
pan, download and dismissal. PDF and file links, upload retry, pasted attachments,
review notes, approvals, source tabs, task worktrees and the review engine continue
to use StudyBuddy's existing APIs. Turn durations come from native/server timing;
old records without timing do not receive invented durations. Only provider-exposed
reasoning summaries are displayed.

`/plan` selects the native collaboration mode. A proposed plan can be expanded,
copied, downloaded or edited before implementation. The decision card submits
the selected implementation option in default mode; freeform feedback remains
in Plan mode. Native questions replace the composer, retain answers across task
switches and distinguish an option from identically worded freeform text.

Goal uses Codex's native autonomous-goal lifecycle when the runtime exposes it.
The composer and goal editor support replacement and native progress counters,
including budget usage when Codex supplies a budget. Pause, resume, clear and status checks preserve their request
identity. A lost response is checked without replaying the mutation. Autonomous
turns hold the normal message queue; StudyBuddy publishes their manuscript result
after native idle is confirmed. Long objectives and attachments live outside the
publishable worktree and remain available to forks until their last owner is
deleted. A disconnected goal requires an explicit resume.

Sketch opens a drawing dialog with the extension's tools, color palette, stroke
controls, selection, text, eraser and undo/redo interactions. Saving creates a
PNG attachment. Reopening that draft retains editable drawing data for the
current page session. Cancelling a dirty sketch asks before discarding it;
failed uploads retain the drawing and original attachment.

`/review` offers uncommitted changes or a base branch, then invokes native
`review/start`. A new chat receives an isolated task worktree containing the
current manuscript changes. The result stays in the conversation and does not
publish a PDF review round. Native review markers are hidden, as in the extension.
Unknown replies are reconciled against the saved conversation baseline.

`/fork` creates a native conversation fork in a new StudyBuddy task worktree.
It preserves the completed history, timing, attachments and current file state
without resending the original question. StudyBuddy offers the new-worktree
choice because independently editable tasks require separate working directories.
A lost reply is resolved by the exact destination directory and source thread;
an ambiguous result never triggers another fork. This differs from restarting
a task, which sends its original instructions to a new agent conversation.

Dictation uses the extension's buffered recording path: the microphone starts
only after pressing Dictate, and Stop transcribes the recording into the draft.
Transcribe and send inserts the result and submits the current draft, including
its file references, through the normal send flow.
Cancel releases the device and request; failed transcription retains the audio
for Retry. The host binds each recording to the current ChatGPT account, obtains
credentials through the existing Codex runtime and sends audio only to the fixed
official transcription endpoint. Credentials never reach the browser or disk.
API-key accounts do not expose the microphone. Desktop permits audio capture
only in the main workspace; operating-system microphone consent still applies.

Production contains no official extension bundle, iframe, separate chat daemon,
new account store or copied session data. The queue is computed from existing
runs, and the UI uses the same task as the manuscript/review panes. Host adaptations
are the multi-agent chooser, paper/review controls, task history and settings
routes. Backend capability differences remain visible rather than being replaced
with inert controls. StudyBuddy's PDF review and restart actions are separate
operations. Dictation uses buffered transcription rather than the optional live
WebSocket enhancement. ChatGPT workspace access remains subject to the remote
service's account policy, and a refusal is reported without trying another account
or endpoint. Account-gated features and the host adaptations above prevent
claiming full feature parity with every extension configuration.

## Verification

`npm run test:ui` includes `scripts/check-codex-chat.mjs` and
`scripts/check-composer-editor.mjs`, together with the `check-codex-plan`,
`check-codex-goal`, `check-codex-review`, `check-codex-sketch` and
`check-codex-dictation` checks. They serve the built app
with disposable deterministic HTTP fixtures and write desktop/mobile light/dark
screenshots under `test-results/`. Tests cover official measured geometry, footer
and slash interactions, IME, draft preservation, send retry, queue editing and
recovery, atomic references, native compaction states, approvals and task/provider
switches. The
frozen measurement source is `tests/fixtures/codex-chat-reference.json`; the test
does not derive expected values from StudyBuddy's stylesheet. Existing attachment,
model, permission, restart, note and workspace tests exercise the integrated
controls. Backend tests use fake app-server replies and notifications, including
races and recovery. These checks do not call a real model.
Fork and new-chat code review also exercise real disposable Git worktrees
through the review engine's public HTTP interface, with fake native agent replies.
They verify source preservation, retained attachment ownership and uncertain
fork recovery without direct writes to the engine database.
Dictation checks use simulated audio devices, credentials and upstream replies,
including account changes and real local HTTP cancellation. Real microphone
consent and the authenticated remote transcription service are not exercised.

The real extension comparison is separate from those mocks. Its screenshots are
produced by the official webview; its model/account/thread data still come from a
fake app-server. An actual model run, every account-gated command and every target
OS are separate acceptance checks.

Modern Web Guidance used: `menu`, `toolbar` and `accessibility` for named controls,
keyboard navigation and focus restoration; `viewport-aware-dropdowns` for
anchored menus with a coordinate fallback; `dialog` and `light-dismiss-a-dialog`
for native image/queue modal dismissal; `ime-safe-enter-submit` for composition-safe Enter handling; `css` for
scoped tokens; and `scroll-position-aware-elements` for preserving scroll/follow
behavior across supported browsers. `form-factor-adaptation` keeps the drawing
surface and tools usable at narrow viewport sizes. New CSS capabilities use local fallbacks
where required by the repository's browser policy.
