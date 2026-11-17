# Official Codex chat reference

This records the visual and interaction evidence used for the StudyBuddy chat
port. It separates the real extension from the handwritten prototype recovered
from DSH session `session-71463d69-44fa-466e-9106-89fb923f5409`.

## Source identity

- Extension: `openai.chatgpt`, manifest version `26.51111.21308`, Darwin arm64.
- Local VSIX: `/Users/ocean/Downloads/re-work/openai.chatgpt-26.51111.21308-darwin-arm64.vsix`.
- VSIX SHA-256: `6cbfc1bba9237e9d3287ab18f246041c0746b19b1c5cbf674a04b74849f840ae`.
- Extracted extension: `/Users/ocean/Downloads/re-work/extracted/extension`.
- `webview/assets/composer-content-6cc26a542ed9.js` SHA-256:
  `c70d4fb79d2bf4bcc6caaae3e8d157fba901abb29ee004ada5ee0621e4356bae`.
- `webview/assets/app-initial-f8f84852daaa.js` SHA-256:
  `971cefb5f37b304c9e764a4b0cf6a381176e65fe7bf377c6ef6398bd5c77c8df`.

The extension's `initialize` request reports client version `26.1111.21308`;
the package manifest and VSIX identify the artifact above. Both values are
recorded rather than silently treating them as equal.

Readable source extracts are in `re-work/round-19-readable` and
`re-work/round-21-readable`. The recovered `codex-bridge/web` implementation is
a useful starting point, but is not an official rendered reference.

## How the official reference was captured

On 2026-11-17, with explicit approval for isolated UI automation, Playwright
attached to a separate VS Code extension development host through loopback CDP.
The host used its own user-data directory, extensions directory, empty fixture
workspace and `CODEX_HOME`. `chatgpt.cliExecutable` pointed to a deterministic
JSONL fake app-server. It supplied model, account, configuration and thread data;
it did not execute Codex, a model, shell commands or user workspaces.

The real extension host and unmodified official webview rendered the UI. No
replacement React tree or guessed webview bridge produced these screenshots.
The fixture was an API-key account with no token and `requiresOpenaiAuth: true`.
The model catalog and messages were synthetic. The host could request auxiliary
operations such as title generation; these reached the same fake server.

Local artifacts are under `test-results/official-codex-reference/`:

- `launch.mjs`, `runner.cjs`, `fake-app-server.mjs`: isolated host and fixture.
- `process.json`, `app-server.jsonl`: launch arguments and protocol receipt.
- `*-dom.html`, `geometry-*.json`: captured markup and computed geometry.
- `official-*.png`: screenshots of the real extension, listed below.

These are ignored local test artifacts, not a shipped webview or a CI dependency.
The captured glyphs used by the port are static SVG paths. Production StudyBuddy
does not load the official extension bundle, iframe or its account store.

For a local repeat, the retained harness requires the source extension path and
Node executable recorded in `launch.mjs`/`fake-app-server.mjs`; it uses CDP port
19341. Launch `node test-results/official-codex-reference/launch.mjs`, wait for
`ready`, then attach Playwright to `http://127.0.0.1:19341`. Interact with
`page.frameLocator('iframe.webview').frameLocator('iframe')`. Complete onboarding
if shown. A `stop` file in that directory ends the extension test host. The
disposable VS Code cache/profile is removed after capture. Repeating this native
automation requires the same explicit UI-automation authorization.

## Rendered states

The main comparison size is **537 × 794 CSS pixels**, DPR 2. Screenshots crop the
webview body and therefore exclude VS Code's outer titlebar. The light theme is
Default Light Modern; the dark theme is Default Dark Modern. Slash submenu
screenshots captured before resizing are 290 CSS pixels wide; geometry metadata
records that distinction.

| State | Screenshot | Observed behavior |
| --- | --- | --- |
| Active conversation | `official-active-thread-light.png` | User bubble, assistant text, active indicator and Stop |
| Idle after interruption | `official-idle-thread-light.png`, `official-idle-thread-dark.png` | “You stopped”, message actions and follow-up composer |
| Footer effort picker | `official-footer-effort-light.png` | Floating effort slider; selected effort above a model link |
| Footer model list | `official-footer-model-list-light.png` | Model link replaces slider contents with a plain checked list |
| Slash root | `official-slash-root-light.png` | Capability-dependent commands above the composer |
| `/model` | `official-slash-model-submenu-light.png` | Recent complete configurations, numbered shortcuts, effort and service tier |
| `/reasoning` | `official-slash-reasoning-submenu-light.png` | Effort rows with independent keyboard highlight and selected checkmark |
| History | `official-history-menu-light.png` | Pane-width search popup, relative time and per-chat activity ring |
| Settings | `official-settings-menu-light.png` | Account status, Codex settings, keyboard shortcuts and logout |
| Chat actions | `official-chat-actions-light.png` | Rename, Copy submenu and Archive |
| Queue | `official-queue-light.png` | Inline Steer, delete and per-message overflow controls |
| Paused queue | `official-queue-paused-light.png` | Interruption notice and Resume; failed steer remains Retry |
| `/status` | `official-status-dark.png` | Persistent card above composer, Session/Chat ID and rate-limit rows, explicit Close |
| `@` root | `official-mention-dark.png` | Add section, Files and folders, Goal, Sketch and file-search prompt |
| Command approval | `official-approval-command-light.png`, `official-approval-command-options-light.png` | Replaces composer; Deny, Allow once and an offered command-rule choice; Escape from menu only dismisses menu |
| File approval | `official-approval-files-light.png`, `official-approval-files-options-light.png` | File list with expandable changes; Allow all edits uses the conversation decision |
| Permission approval | `official-approval-permissions-light.png`, `official-approval-permissions-options-light.png` | Requested access and conversation-scoped approval; no inferred permanent grant |
| `/mcp` | `official-mcp-status-light.png` | Read-only server rows, enabled state and authentication status; Escape retains `/` |
| File search and mention | `official-file-search-light.png`, `official-file-mention-light.png` | Atomic inline file link and icon; the native submitted input uses Markdown links and empty `text_elements` |

| Plan mode | `official-plan-command-light.png`, `official-plan-mode-light.png` | Real command selection enters Plan mode; no ordinary message is sent by the toggle |
| Completed Plan and questions | `official-plan-complete-light.png`, `official-plan-question-light.png` | Native plan card with 320px preview; progressive questions and model footer remain below |
| Goal card | `official-goal-card-light.png` | Native goal state, progress, Pause/Clear/Edit; submitted objective has a separate “Sent as goal” label |
| Goal editor | `official-goal-editor-light.png` | Native dialog with separate icon and heading, multiline objective, Close, Cancel and Save |
| Code review | `official-review-command-light.png`, `official-review-menu-light.png` | Review uncommitted changes or a named base branch; real submenu, no review operation executed |
| Fork | `official-fork-command-light.png`, `official-fork-menu-light.png` | This VS Code build offers “Fork chat” in the current workspace; StudyBuddy's isolated-worktree destination is an explicit multi-agent adaptation |

Early `boot.png`, `after-onboarding.png`, `official-empty.png` and
`official-effort-only-light.png` are diagnostic captures; they are not the final
authenticated state. `official-empty-light.png` includes the optional app-download
banner. The later settled captures take precedence.

The later approval/MCP/file captures use the same isolated fixture and viewport.
`approval-reference-receipt.json` records actual scoped response payloads;
`file-mention-submission.json` records the real submitted text, without reading
any user file or invoking a model. Their additional dimensions are recorded in
`geometry-approval-command.json` and `geometry-mcp-status.json`. The approval
card is 521 CSS pixels wide at a 537-pixel viewport, with a 25-pixel radius.
The MCP menu uses a 20-pixel radius and 4-pixel padding; its disabled server rows
use 12-pixel text at 50% opacity, with authentication on the second line.

## Measured geometry

The complete computed values are in `geometry-thread.json`,
`geometry-containers.json`, `geometry-footer.json` and `geometry-dark.json`.

| Element | Official measured value |
| --- | --- |
| UI font | 13px system font, body line height 19.5px |
| Conversation text | 13px, line height 21.125px |
| Chat margins | 16px on each side |
| User bubble | 22px radius, 10px × 16px padding, maximum width 70% |
| Composer | 22px radius, 8px side inset, 16px bottom inset, empty height 98px |
| Editor | 13px / 20px, minimum height 40px |
| Footer buttons | 28px high |
| Navigation | 30px high; 22px icon buttons with 4px gaps |
| Model-list popup | 254px wide, 20px radius; height depends on model count |
| Queue rows | 32px high, 2px × 10px padding, 8px gap |
| Empty mark | 48px SVG box, visible glyph approximately 40px |

Light theme: pane `#f8f8f8`, text `#3b3b3b`, composer and elevated surfaces white.
Dark theme: pane `#181818`, text `#cccccc`, composer `#1f1f1f`, elevated surfaces
`#313131`. The user bubble mixes the foreground at 5% over the pane.

## Built StudyBuddy comparison

The built interface was also rendered on 2026-11-17 with a disposable HTTP
fixture at the same **537 × 794 CSS pixels**, DPR 2. The crop excludes
StudyBuddy's workspace toolbar and agent titlebar, matching the official body
crop. `test-results/codex-reference-studybuddy-geometry.json` records the crop;
`codex-reference-thread-light.png`, `codex-reference-thread-dark.png`,
`codex-reference-history-light.png` and `codex-reference-settings-light.png`
record the settled interface. Both themes and the anchored menus were inspected.
The fixtures contain different conversation text, so these are geometry and
interaction comparisons rather than identical-content pixel comparisons.

`scripts/check-codex-chat.mjs`, included in the UI suite, checks measured bubble,
composer, font and navigation values, desktop/mobile layout and the native task
actions. Header coverage includes history search, arrow-key navigation, Escape
and focus restoration, outside-click dismissal, task switching with separate
drafts, and the Settings menu opening the real keyboard-shortcuts page.

## Interaction findings and boundaries

### Native Goal startup

The fixed `rust-v0.164.0` implementation supports a Goal before the first user
turn. `thread/goal/set` persists the explicit user instruction and goal, replies,
then applies runtime effects ([processor lines 183–233](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/thread_goal_processor.rs#L183-L233)).
The Goal service calls `apply_external_goal_set`; an active goal reaches
`continue_if_idle`, which submits `start_turn_if_idle` with a native goal
continuation and `turn_trigger: "goal"` ([service lines 70–78](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/ext/goal/src/api.rs#L70-L78),
[runtime lines 208–224 and 410–503](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/ext/goal/src/runtime.rs#L410-L503)).
The official API regression starts an empty thread, sets its goal, and observes
multiple completed turns without sending `turn/start`
([test lines 129–159](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/tests/suite/v2/thread_goal_empty_responses.rs#L129-L159)).

The captured VS Code **new-chat composer** sends a first `/goal …` turn and then
sets the goal after that turn is accepted (`composer-content-6cc26a542ed9.js.txt`
lines 3050–3056 and 3121–3146). Its existing-thread goal editor directly sets the
goal; its optional transcript entry is local presentation
(`app-initial-050fbd442c4f.js.txt` lines 15594–15628).
StudyBuddy uses native `goal/set` with `origin: "user"`, current thread settings,
and a local authored-message marker. It does not add a second ordinary turn.
Native provenance records a contextual user fragment and emits only raw response
items ([retained context lines 77–118](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/session/retained_context.rs#L77-L118),
[raw event lines 4336–4344](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/session/mod.rs#L4336-L4344)).
That path does not emit the ordinary visible user-turn item. StudyBuddy ignores
raw response events, so its authored Goal bubble is not duplicated.
This startup behavior is verified against the fixed upstream implementation and
its deterministic test, not by making a live model request.

### Other interactions

- Entering a model or reasoning slash submenu leaves `/` in the editor. Selecting
  an option removes it. One Escape closes the submenu and retains `/`; it does
  not show the root list again. The footer picker has a different slider-first
  interaction from the slash menus.
- Model and reasoning commands disappear when the fixture says authentication
  is not required. That early fixture branch is not the final signed-in baseline.
- Each queued-message Steer sends only that message to `turn/steer`, with
  `expectedTurnId` and `clientUserMessageId`. A rejected steer changes the selected
  row to Retry and leaves the other queued messages present. Clicking Stop sends
  `turn/interrupt` and pauses the queue. A direct editor Escape did not interrupt
  in this VS Code-hosted run; its host-keybinding behavior remains unverified.
- `/status` is an attached card, not the context-ring popup. It remains open when
  Escape dismisses another menu. Context and rate limits were not populated in
  the API-key fixture, so their full live-account layout is not certified here.
- The API-key fixture hides dictation. No microphone was activated. ChatGPT
  authentication, native speech capability and billing/rate limits can change
  available controls. StudyBuddy must gate unsupported capabilities instead of
  showing inert controls.
- `@` root, file search, selection and submitted text were captured. File search
  returned deterministic fixture paths through the native `fuzzyFileSearch`
  request. Selecting a file produced a ProseMirror atom; the submitted text used
  `[manuscript.tex](manuscript.tex)` and an empty `text_elements` array. No real
  user files were searched. Image overlay behavior was inspected in the official
  source; an official image-upload interaction was not captured.

The original `codex-bridge/evidence/reference.png` is a separate user-supplied
official screenshot. Its ChatGPT-account controls differ from the API-key
fixture. The old `webview-boot.png` only showed a loading mark. Prototype
`composer-model-menu.png`, `queue-*.png` and `render-preview.mjs` output do not
establish official visual parity.

StudyBuddy's agent identity, multi-agent task history, manuscript/review controls,
provider settings and supported backend capabilities are explicit host
adaptations. This evidence establishes specific rendered reference states; it
does not claim complete parity with every official account, feature flag,
extension version or interaction.

The header/history implementation followed Modern Web Guidance `menu` and
`accessibility`: native popover dismissal where available, a fallback for older
browsers, focus restoration, keyboard navigation and named native controls.

## Additional official captures

The later Plan, Goal, Review and Fork captures above use the same pinned official
extension in the disposable fixture host, at **290 × 794 CSS pixels**, DPR 2,
Default Light Modern. They are genuine extension DOM/screenshots. The model catalog,
thread contents and Goal statistics are deterministic transport fixtures. The
corresponding `*-dom.html` files and `official-goal-card-measurements.json` / `official-goal-editor-measurements.json` preserve
markup and computed styles; StudyBuddy's independent browser screenshots are
separate artifacts and do not constitute official runtime evidence.

For the Goal submission receipt, `/goal` was selected from the real command menu
with Enter before entering the objective and clicking Send. The fake server recorded
`thread/start`, then `turn/start` with text
`/goal Check the manuscript and verify every reference.\n`, followed by
`thread/goal/set` with the plain objective and active status. This proves the
pinned extension's new-chat sequence under that fixture. It does not prove that
a second ordinary turn is required by the native Goal API; the native startup
source and StudyBuddy's direct Goal lifecycle are described separately above.
No real agent inference was performed. Review and Fork captures stop at their
menus; no operation was invoked on the fixture's enclosing Git repository.

The buffered dictation UI is source-backed by `app-initial-f8f84852daaa.js`
(`insertDictationText`, `VXa`, `HXa`, `UXa`). The source distinguishes recording,
transcription, cancel, retry and explicit “Transcribe and send”; inserts at the selected text range with boundary
spaces; and uses an audio waveform. StudyBuddy exercises native MediaRecorder
and MediaStream cleanup through deterministic fake-device tests, with its actual
ProseMirror editor and binary HTTP contract. No microphone permission, live speech
service or official dictation runtime screenshot was used for acceptance. Streaming
partial transcripts are not emulated.

The recording controls followed Modern Web Guidance `toolbar` and
`accessibility`: named native buttons keep browser keyboard activation, capture
states retain reachable Cancel/Stop controls, errors are announced, and coarse
pointers receive larger targets. The controls remain a simple button group rather
than claiming composite toolbar navigation that they do not implement. Capability
checks preserve the ordinary text composer when recording is unavailable; audio
visualization is optional and its absence leaves a visible recording status.
