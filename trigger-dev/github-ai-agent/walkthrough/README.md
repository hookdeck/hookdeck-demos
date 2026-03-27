# Video Script: GitHub Agent Automation with Hookdeck + Trigger.dev

**Format:** Talking head + screen recording
**Target length:** 2–3 minutes
**Tone:** Collaborative, developer-to-developer

---

## ACT 1 — Talking head (0:00–0:35)

_[Camera on Phil. Plain background or Hookdeck-branded backdrop.]_

**PHIL:**

Trigger.dev is great for running durable, reliable tasks — but to trigger those tasks from a webhook, you need to make an HTTP API call. That means you need something to receive the webhook, verify the signature, transform the payload into the shape the Trigger.dev API expects, and then send it on.

You could spin up infrastructure to do that yourself — but why would you? That's not your application logic.

That's where the Hookdeck Event Gateway comes in. The Event Gateway can act as a lightweight, serverless webhook ingestion layer. It receives the event, verifies it came from where it's supposed to, transforms the payload to match what Trigger.dev expects, and delivers it to your task's trigger URL. And you get observability, retries, and replay on every event — for free.

---

## ACT 2 — Screen: architecture diagram (0:35–0:55)

_[Cut to screen. Show the architecture flow diagram — either the Mermaid diagram rendered, or a clean slide version.]_

_[Voiceover or on-screen annotation:]_

**VOICEOVER / CAPTION:**

So, how does this work? An event occurs on GitHub, GitHub fires a signed webhook → the Event Gateway verifies the signature and transforms the payload → Trigger.dev receives the event in the right format and runs the task durably.

_[Hold on diagram for 5 seconds, then transition to live screen recording.]_

---

## ACT 3 — Screen demo: task router (0:55–1:35)

_[Screen recording. Terminal open in the `github-ai-agent` directory.]_

**VOICEOVER:**

Here's that pipeline in action. One command prepares a demo branch and pushes a commit to GitHub...

_[Run `npm run demo:push` in the terminal. Let the output complete — it resets `demo/hookdeck-trigger` to match main and pushes an empty commit.]_

...now over to GitHub to open a pull request from that branch.

_[Switch to GitHub UI. Open a new PR from `demo/hookdeck-trigger` → default branch. Give it a clear title. Submit — don't wait for the automation.]_

The webhook fires the moment the PR is opened. Over in the Event Gateway dashboard, you can already see it arrive — verified, transformed, delivered to Trigger.dev with a 200 response.

_[Switch to Hookdeck Events dashboard. Click into the event. Show the transformed payload with the `event: "pull_request"` field extracted from the headers. Point out the 200 delivery status.]_

While that was happening, Trigger.dev received the event and dispatched a child run to `handle-pr`.

_[Switch to Trigger.dev Runs. Click into the `github-webhook-handler` run. Expand to show the `handle-pr` child run. Click into `handle-pr` and show the steps: reviewing PR, diff size, posting review comment.]_

And back on the PR — Claude has posted an AI review summary.

_[Switch back to GitHub. Show the AI Review Summary comment on the PR.]_

---

## ACT 4 — Talking head bridge (1:35–1:50)

_[Cut back to camera.]_

**PHIL:**

That's using a single Event Gateway connection with a router task in Trigger.dev to fan out to the right handler. But you can also push the routing decision up to the Event Gateway itself — using separate connections with event-type filters, so each event type goes straight to its task, no router code involved.

---

## ACT 5 — Screen demo: connection routing (1:50–2:30)

_[Cut to screen. The three filtered connections are already created and active. `github-to-main-handler` is paused. Start on GitHub.]_

**VOICEOVER:**

To demonstrate this pattern I'll open an issue directly in GitHub...

_[Open a new issue in the GitHub UI — title something like "Will this be labelled automatically?". Submit — don't wait.]_

...the webhook fires immediately. In the Event Gateway, you can see it routed straight through `github-to-handle-issue` — the other connections didn't fire.

_[Switch to Hookdeck Events. Show the issue event going through `github-to-handle-issue` with 200. Point out the paused `github-to-main-handler` row with 0 attempts.]_

In Trigger.dev, `handle-issue` is marked as a root task — invoked directly by the Event Gateway, not by a router. Claude classified the issue and applied the label.

_[Switch to Trigger.dev. Show the `handle-issue` run marked Root. Show the log steps: labelling issue, applied labels.]_

And back on the issue — the label is there.

_[Switch to GitHub. Show the label applied to the issue.]_

---

## ACT 6 — Talking head outro (2:30–2:50)

_[Cut back to camera.]_

**PHIL:**

The Hookdeck Event Gateway handles the webhook edge — verification, transformation, retries, observability. Trigger.dev handles durable task execution. Together, you get a production-ready GitHub automation pipeline without standing up any extra infrastructure.

The full tutorial — including both routing patterns and all the code — is linked below.

_[Hold on Phil for 2 seconds, then cut to end card or fade.]_

---

## END CARD (optional, 2:50–3:00)

_[Static screen with:]_

- hookdeck.com
- trigger.dev
- Link to tutorial / blog post

---

## Production notes

- **Diagrams:** Use the Mermaid diagrams from the guide rendered as clean images, or recreate as slides. The task router diagram and connection routing diagram are both in GUIDE.md.
- **Demo prep:** Have the Hookdeck connections and Trigger.dev tasks already deployed before recording. The demo should feel instant — no waiting for setup.
- **Demo scripts:** `npm run demo:push` (Act 3) handles branch reset and empty commit automatically — run it from the `github-ai-agent` directory. `npm run demo:issue` exists but the GitHub UI is more visual for the issue demo so it's not used in the script. See [Demo scripts](#demo-scripts) below for full details.
- **Hookdeck events dashboard:** Expand the event detail to show the transformed payload (the `event: "pull_request"` field) — this is the visual proof of what the transform does.
- **Trigger.dev run view:** The child run timeline (handle-pr showing the three log steps) is the most compelling screen — linger here.
- **GitHub PR comment:** The rendered AI Review Summary is the payoff — make sure it's visible and readable on screen.
- **Connection routing demo:** The "Root" badge on handle-issue is the key visual difference from the task router path — call it out explicitly.

---

## Demo scripts

These helpers use the [GitHub CLI](https://cli.github.com/) (`gh`) against the repo you have checked out. Run them from the `github-ai-agent` package root (`npm run demo:*`).

| Script | npm script | What it does |
|--------|------------|--------------|
| `issue.sh` | `demo:issue` | Opens a disposable issue → **`handle-issue`** (labels). |
| `push.sh` | `demo:push` | Resets branch **`demo/hookdeck-trigger`** to match `main` (or the repo default), adds **one empty commit**, pushes → **`handle-push`** (Slack summary if configured). |
| `pr.sh` | `demo:pr` | Runs **`demo:push`**, then opens a PR from `demo/hookdeck-trigger` → default branch if no PR exists → **`handle-pr`** (AI comment). |

### Branch name

The demo push branch is fixed to **`demo/hookdeck-trigger`** (override with env `DEMO_BRANCH` if needed). Empty commits avoid editing tracked files; the branch is **reset to the default branch each run** and force-pushed with `--force-with-lease`, so you do not accumulate random demo files—only extra empty commits on that branch over time. Delete the remote branch when you want a clean slate:  
`git push origin --delete demo/hookdeck-trigger`

### Suggested order

1. `npm run demo:issue` — quick, no git writes.  
2. `npm run demo:push` — exercises push → Slack.  
3. `npm run demo:pr` — includes a push + opens the PR for the review comment.

Use a clean working tree (`git status` empty) before `demo:push` / `demo:pr`.
