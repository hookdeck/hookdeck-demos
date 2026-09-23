# Findings

Hookdeck CLI version: **2.6.0**, pinned as an npm dependency
(`hookdeck-cli@2.6.0`) rather than taken from a global install, so these results
are reproducible and a newer global CLI cannot silently change them. API version
`2026-09-01`, which is what that CLI targets.

Status legend:

- **verified** - observed in this repo, with the command and output shown
- **pending** - the scenario is scripted but has not been run against a
  Hookdeck project yet, so nothing is claimed
- **unverified** - stated in docs or source but not observed here

Nothing below is claimed unless it is marked verified.

**Machine naming.** Machines were renamed partway through: `build-a-01` ->
`group-a-host-01`, `build-a-02` -> `group-a-host-02`, `build-a-03` ->
`group-a-host-03`, `build-b-01` -> `group-b-host-01`. Console output quoted
below is reproduced exactly as it was captured, so transcripts recorded before
the rename still show the old names. The evidence is unchanged; only the labels
moved.

## What has been verified so far

These needed no Hookdeck project.

### The CLI surface the demo depends on exists in 2.6.0 - verified

```console
$ hookdeck gateway request retry --help
Retry a request by ID. By default retries on all connections. Use --connection-ids to retry only for specific connections.

Examples:
  hookdeck gateway request retry req_abc123
  hookdeck gateway request retry req_abc123 --connection-ids web_1,web_2

Flags:
      --connection-ids string   Comma-separated connection IDs to retry (omit to retry all)
```

`hookdeck gateway request ignored-events <req_id>` exists and takes
`--output json`.

### Request list cannot be filtered by ignored cause or connection - verified

```console
$ hookdeck gateway request list --help
Flags:
      --body string                 Filter by body (JSON string)
      --created-after string        Filter requests created after (ISO date-time)
      --created-before string       Filter requests created before (ISO date-time)
      --headers string              Filter by headers (JSON string)
      --id string                   Filter by request ID(s) (comma-separated)
      --path string                 Filter by path
      --rejection-cause string      Filter by rejection cause
      --source-id string            Filter by source ID
      --status string               Filter by status
      --verified string             Filter by verified (true/false)
```

(Re-checked against 2.6.0. The only change from 2.5.0 is that `--status` now
documents its values: `accepted, rejected`.)

There is a `--rejection-cause` filter but no ignored-cause filter and no
connection filter. `CLI_DISCONNECTED` is an *ignored* cause, not a rejection
cause, so `--rejection-cause CLI_DISCONNECTED` is not expected to work.
**Pending**: whether it silently returns nothing or errors, and whether the
underlying API accepts an undocumented filter the dashboard uses.

### `webhook_ids` is the retry-scoping field - verified (indirectly)

`webhook_ids` appears as a JSON struct tag in the CLI binary, alongside the
`/2025-07-01/requests` path:

```console
$ strings /opt/homebrew/bin/hookdeck | grep -o 'json:"webhook_ids[^"]*"'
json:"webhook_ids,omitempty"
json:"webhook_ids"
```

It is not in the public API reference. **Pending**: that a retry scoped this
way actually delivers only to the named connection.

### `hookdeck listen` fails closed on bad credentials - verified

```console
LISTEN could not authenticate with HOOKDECK_API_KEY: error: unexpected http status code: 401, raw response body: Unauthorized
LISTEN HOOKDECK_API_KEY must be a Project API key from the Hookdeck dashboard (Project Settings > API Keys). For a CLI client key, use --cli-key instead.
LISTEN exited code=1 signal=null
```

Worth noting for the fleet design: `listen` reads `HOOKDECK_API_KEY` straight
from the environment, so a machine does not strictly need `hookdeck ci` first.
The demo still runs `ci` into its own config file so that `gateway` commands
cannot act on whatever project the operator is logged into.

### One connection per machine is not a billing or quota cost - verified

From https://hookdeck.com/pricing: connections are listed as "Unlimited" on all
four plans, and there is no per-connection charge or cap. Billing is on events
(10,000 included per month, then metered per 100k) and on delivery throughput
(included 5 events/sec per destination).

So "approach 1 needs more connections" is not a cost argument, and should not be
conceded as one. Worth having ready, because it is the first objection the
connection count invites.

### Event count is the same under both approaches - unverified

It follows from documented behavior rather than from measurement. Approach 1
creates one event per matching connection; approach 2 creates one event per
attached session ("Hookdeck creates one event per matching session. Sessions do
not compete"). For a group of three machines that is three events either way, so
the billed unit should be identical.

**Pending**: confirm by comparing `events_count` per request between the two
sources for the same webhook. The happy-path scenario already sends the same
payload to both, so the numbers are there to read once it has been run.

### Included throughput per destination may favor approach 1 - unverified

Throughput is included as 5 events/sec *per destination*. Approach 1 has one
destination per machine and approach 2 one per group, which would mean approach
1 carries more included headroom for the same traffic. Not claimed: the docs
also say delivery rates are not available for CLI destinations, so how
throughput is accounted for a CLI destination is unclear and needs checking
before this is used in an argument.

### `connection upsert` is genuinely idempotent - verified

Run against a live project. `fleet.yaml` was edited to change one group's repo
filter, then `npm run setup` was re-run. Every connection ID was unchanged and
the filter was updated in place:

```console
  fleet-demo-build-a-01      web_nySLNQcflZZv -> web_nySLNQcflZZv  SAME (updated in place)
  fleet-demo-build-a-02      web_974sIt7UKQNc -> web_974sIt7UKQNc  SAME (updated in place)
  fleet-demo-build-a-03      web_G40NXwAm0cK0 -> web_G40NXwAm0cK0  SAME (updated in place)
  fleet-demo-build-b-01      web_lTCewqHBj5SJ -> web_lTCewqHBj5SJ  SAME (updated in place)
  fleet-demo-group-a         web_z2pDh5N4PU4l -> web_z2pDh5N4PU4l  SAME (updated in place)
  fleet-demo-group-b         web_FmtkLM3Qsn3B -> web_FmtkLM3Qsn3B  SAME (updated in place)
```

This is what makes "run it on every machine boot" safe, so it is worth having
confirmed rather than assumed.

### Crash and clean shutdown are distinguishable, and need process groups - verified

Tested with a stub standing in for the CLI, so this verifies the harness rather
than Hookdeck's behavior.

`fleet crash` sends `SIGKILL` to the whole process group. Both the supervisor
and the listener die, with no orphan left holding the session:

```console
$ npx tsx shared/src/fleet.ts crash per-machine build-a-02
Crashing 1 machine(s) for per-machine:
  - build-a-02 pgid=35097 SIGKILL -> CRASH (session held for the ~2m grace window)

$ pgrep -f "hookdeck" ; lsof -nP -iTCP:4102 -sTCP:LISTEN
(no output - no orphaned listener, port released)
```

`fleet down` sends `SIGTERM` to the supervisor only, which forwards `SIGINT`:

```console
2026-09-23T16:49:09.343Z SHUTDOWN clean (SIGTERM) - sending SIGINT to hookdeck listen
2026-09-23T16:49:10.198Z LISTEN stub listen: SIGINT -> clean WebSocket close
2026-09-23T16:49:10.199Z LISTEN exited code=0 signal=null
```

This was a real bug found while building: signaling the whole process group on
a clean stop delivered `SIGTERM` directly to the listener, so the demo would
not have been exercising the Ctrl+C path at all. Whether the real CLI treats
`SIGTERM` the same as `SIGINT` is **unverified**, which is exactly why the
supervisor forwards `SIGINT` explicitly rather than relying on it.

### The npm CLI wrapper does not forward signals - verified, and it is a product bug

`node_modules/.bin/hookdeck` is a Node shim that runs the Go binary with
`execFileSync` and `stdio: 'inherit'`:

```js
execFileSync(binaryPath, process.argv.slice(2), { stdio: 'inherit' });
```

`execFileSync` blocks the Node event loop, so the shim cannot install or run a
signal handler, and it forwards nothing. A `SIGINT` or `SIGTERM` delivered to
the `hookdeck` process therefore never reaches the CLI.

Observed: signalling the shim, the listener had still not exited after 12
seconds and had to be `SIGKILL`ed. Spawning the platform binary directly
instead, the same signal produced a clean exit in about 5ms:

```console
2026-09-23T17:23:48.440Z SHUTDOWN clean (SIGTERM) - sending SIGINT to hookdeck listen
2026-09-23T17:23:48.445Z LISTEN exited code=0 signal=null
```

Why it matters beyond this demo: an interactive Ctrl+C still works, because the
terminal signals the whole foreground process group and the Go binary gets the
signal directly. It is *programmatic* single-PID signalling that breaks - which
is precisely what systemd, Docker and supervisord do. A machine running
`hookdeck listen` as a managed service via the npm CLI would, on every
`systemctl stop`, fail to close its WebSocket cleanly. The session would then be
held for the reconnect grace window instead of dropped immediately, and events
arriving in that window are discarded. The intended clean-stop behavior silently
becomes crash behavior.

Suggested fix: have the shim `spawn` rather than `execFileSync`, and forward
`SIGINT`/`SIGTERM` to the child. Affects `hookdeck-cli@2.6.0`.

Filed as https://github.com/hookdeck/hookdeck-cli/issues/429, cross-referencing
https://github.com/hookdeck/hookdeck-cli/issues/163 (Docker service takes 10s to
shut down), which looks like the same root cause on a different distribution
channel.

The demo works around it by resolving
`node_modules/hookdeck-cli/binaries/<platform>-<arch>/hookdeck` directly.

### Several sessions on one connection produce one event per session - verified

Observed accidentally, then confirmed. With two listeners attached to each of
the three `group-a` connections, a single inbound request produced six events
with six distinct event IDs, and every machine logged two deliveries of the same
`X-GitHub-Delivery`.

This is the documented approach 2 mechanism, so it is good to have it directly
observed. It is also the failure mode a leaked listener causes: duplicate
delivery with nothing in the logs to explain it.

### Fan-out and one-to-one routing both work - verified

A push for a `group-a` repo reached all three `group-a` machines with the same
`X-GitHub-Delivery`, and a push for the dedicated machine's repo reached only
that machine:

```console
build-a-01  RECV push repo=demo-org/service-api      delivery=738b27ce-... 
build-a-02  RECV push repo=demo-org/service-api      delivery=738b27ce-...
build-a-03  RECV push repo=demo-org/service-api      delivery=738b27ce-...
build-b-01  RECV push repo=demo-org/release-tooling  delivery=8863091a-...
```

### The forwarded request keeps the original body and signature - verified

This answers the open question below without needing a real CI server.
`send-webhook.ts` records the sha256 of the exact bytes posted; each machine
records the sha256 of what it received.

```console
build-a-01: body IDENTICAL (673 vs 673 bytes) | X-Hub-Signature-256 preserved
build-a-02: body IDENTICAL (673 vs 673 bytes) | X-Hub-Signature-256 preserved
build-a-03: body IDENTICAL (673 vs 673 bytes) | X-Hub-Signature-256 preserved
build-b-01: body IDENTICAL (682 vs 682 bytes) | X-Hub-Signature-256 preserved
```

The stub server also recomputes the HMAC over the raw forwarded bytes and logs
the result, which is exactly what a real CI server's own check would do. Every
delivery logs `sig=ok`. So a receiver can keep its existing signature
verification unchanged.

Hookdeck's own verification also ran: the forwarded request carries
`x-hookdeck-verified: true`, along with `x-hookdeck-connection-name`, which
gives the machine a way to know which connection delivered to it.

### `GET /events?request_id=...` silently ignores the filter - verified, and it is a bug

The query parameter is accepted, returns 200, and returns events belonging to
other requests:

```console
request req_OHetuEHu6v8McFBILYAK: 14 events returned, 13 belong to a DIFFERENT request
request req_eb6m2wJgBnOR5Dx4Gi0m: 14 events returned, 11 belong to a DIFFERENT request
request req_Gv4EkYEWihegr9GmpRpm: 14 events returned,  8 belong to a DIFFERENT request
```

The nested path is correct, and is what the CLI's own
`gateway request events <id>` uses:

```console
$ hookdeck gateway request events req_OHetuEHu6v8McFBILYAK --output json
  1 events returned
    evt_NshcTOlDTNKp2ZeXRi | request_id: req_OHetuEHu6v8McFBILYAK | status: SUCCESSFUL
```

```console
request req_OHetuEHu6v8McFBILYAK: 1 events returned, 0 belong to a DIFFERENT request
request req_eb6m2wJgBnOR5Dx4Gi0m: 3 events returned, 0 belong to a DIFFERENT request
request req_Gv4EkYEWihegr9GmpRpm: 6 events returned, 0 belong to a DIFFERENT request
```

This mattered: `recover.ts` skips a request that already has an event on the
machine's connection, which is what makes re-running it safe. With the ignored
filter that check was true for essentially every request, so recovery would have
silently recovered nothing. A filter that is accepted and ignored is worse than
one that errors, because the caller has no way to notice.

Fixed in `shared/src/hookdeck.ts` by using `/requests/{id}/events` and
`/requests/{id}/ignored-events`.

### Failed events during the orphaned-listener window - explained

Three `FAILED` events, all at `17:19:35.391Z`, all with `error_code:
CLI_UNAVAILABLE`, one per `group-a` connection. They are an artifact of the
orphaned-listener bug described above: two sessions were attached to each
connection, Hookdeck created an event per session, and delivery to the stale
session failed.

After the fix, a happy-path run produced four events and no failures. Worth
knowing because `CLI_UNAVAILABLE` on an event is distinct from
`CLI_DISCONNECTED` as an ignored cause: the first means a session existed but
could not be delivered to, the second means no session existed at all. Only the
second is what the recovery script looks for.

### Delivery issues ARE created for CLI destinations - verified, contradicts the brief

The brief stated that issue triggers are not available for CLI destinations.
Three `type: delivery` issues were auto-created against CLI destinations:

```console
$ hookdeck gateway issue list --output json
  id:         iss_59s9RziZq3BCJ57QeF
  type:       delivery
  status:     OPENED
  agg keys:   {"error_code": ["CLI_UNAVAILABLE"], "response_status": [], "webhook_id": ["web_nySLNQcflZZv"]}
```

Note what they aggregate on: `webhook_id`, the connection. Under approach 1
that means an issue names the individual machine. Under approach 2 it can only
name the group. That is another point on approach 1's side, and one we did not
know we had.

The important caveat, and it limits the value: these fired on
`CLI_UNAVAILABLE`, which is a *failed delivery to a session that existed*. A
machine that is simply down produces `CLI_DISCONNECTED`, where no event is
created at all, so there is no delivery attempt and therefore no issue.

**So issues do not detect a machine being down.** They detect a session that
accepted work and then failed. Do not present issues as fleet monitoring.
Whether an issue trigger can be *configured* for CLI destinations, as opposed to
these being auto-created, is still unverified.

### CLI_UNAVAILABLE vs CLI_DISCONNECTED - verified by controlled experiment

These are different states with different recovery paths, and the difference is
purely how long the machine has been gone. One machine was crashed with
`SIGKILL` at 17:43:10 and left down. The same payload was sent twice.

**Inside the reconnect grace window** (sent 17:43:14, 4s after the crash):

```console
req_QaYd8XpppTs6YPb1RVjV  2026-09-23T17:43:14Z
   EVENT   fleet-demo-build-a-02    status=SUCCESSFUL
   EVENT   fleet-demo-build-a-01    status=FAILED  error_code=CLI_UNAVAILABLE
   EVENT   fleet-demo-build-a-03    status=SUCCESSFUL
   IGNORED fleet-demo-build-b-01    cause=FILTERED
```

**Past it** (sent 17:45:12, same machine still down):

```console
req_1s0dvK7qP6Gf5CTRRRC9  2026-09-23T17:45:13Z
   EVENT   fleet-demo-build-a-02    status=SUCCESSFUL
   EVENT   fleet-demo-build-a-03    status=SUCCESSFUL
   IGNORED fleet-demo-build-b-01    cause=FILTERED
   IGNORED fleet-demo-build-a-01    cause=CLI_DISCONNECTED
```

So:

- **`CLI_UNAVAILABLE`** is an *attempt error code on an event that exists*. A
  session was still registered - held open by the grace window - so Hookdeck
  created an event and tried to deliver it. The client was not there. The event
  exists, is `FAILED`, and is therefore retryable like any other failed event.
- **`CLI_DISCONNECTED`** is an *ignored-event cause, and no event is created at
  all*. No session was registered, so there was nothing to deliver to. There is
  no event to retry; recovery has to go back to the request.

Filed as https://github.com/hookdeck/website/issues/810 (documents neither the
grace-window state nor `CLI_UNAVAILABLE`), extending
https://github.com/hookdeck/website/issues/741.

`FILTERED` on `build-b-01` in both is unrelated - that push did not match its
repo filter. Worth noting only because a recovery script must not confuse the
two: an ignored event alone does not mean a machine missed something it wanted.

### Scenario 3 answered: events during the grace window are not queued

This was the open question we had no answer for. Events arriving while a
crashed machine is inside its grace window are **not** held and delivered on
reconnect. They become `FAILED` events with `CLI_UNAVAILABLE`.

That is better than the alternative, though: a failed event still exists, so it
is recoverable through ordinary event retry. But note it does **not** recover by
itself. The `CLI_UNAVAILABLE` event above was still `FAILED` with a single
attempt ten minutes later, with the machine back up - so on a connection with no
explicit retry rule, nothing retried it. Recovery is manual either way; the
difference is only *which* retry you need.

Only once the window closes do events stop being created.

Practical consequence for the fleet: a machine that crashes and returns quickly
is in much better shape than one that stays down, and the boundary is about two
minutes. This is also why the npm shim signal bug above matters so much - it
turns every managed restart into the crash path rather than the clean path.

## Scenario results

All **pending**. Each is scripted and writes a transcript to
`evidence/<scenario>.<approach>.md`. Fill these in from that transcript.

### 1. Happy path - pending

`npm run scenario -- happy-path --approach per-machine` and `--approach per-group`.

Expected: every machine in group-a logs every event for the group's repos;
`build-b-01` logs only `demo-org/release-tooling`. Both approaches should pass this
one identically - the fan-out requirement is not where they differ.

### 2. One machine down past the grace window - pending

`npm run scenario -- down-long --approach per-machine` and `--approach per-group`.

To confirm for approach 1: the request shows a `CLI_DISCONNECTED` ignored event
on that machine's connection; `recover.ts` replays only those events; the
recovered machine catches up and its peers gain no duplicate.

To confirm for approach 2: nothing records the miss, and a group retry
duplicates to the healthy machines.

### 3. Back inside the grace window - answered, see above

`npm run scenario -- down-short --approach per-machine`.

The open question. Events arriving while the session is held but the process is
gone are either queued and delivered on reconnect, or discarded. We have not
verified which, and the answer changes how serious a short crash is.

### 4. Whole group down - pending

`npm run scenario -- group-down --approach per-machine` and `--approach per-group`.

### 5. Clean shutdown vs crash - pending

`npm run scenario -- shutdown-vs-crash --approach per-machine`.

Confirms against the real CLI what has so far only been confirmed against a
stub: a clean shutdown drops the session immediately, a crash holds it for
about 2 minutes.

## Bulk ignored-events retry as a recovery path

Following the lead from https://github.com/hookdeck/website/issues/741.

The endpoint **is** documented, at
https://hookdeck.com/docs/api/bulk.md#bulk-retry-ignored-events - an earlier
note here claimed it was not, which was wrong. What is missing is narrower and
more specific: the `webhook_id` filter is absent from the documented query
fields, `CLI_DISCONNECTED` is never mentioned as a retryable cause, and the
`plan` endpoint's `query` parameter is described as JSON when JSON is rejected.
Filed as https://github.com/hookdeck/website/issues/811. Full shape confirmed
from the OpenAPI document at `GET https://api.hookdeck.com/2026-09-01/openapi`.

### Shape - verified

```
GET  /bulk/ignored-events/retry          list jobs
GET  /bulk/ignored-events/retry/plan     dry run, returns estimated_count
POST /bulk/ignored-events/retry          create job
GET  /bulk/ignored-events/retry/{id}     job status
POST /bulk/ignored-events/retry/{id}/cancel
```

The body is `{ "query": { ... } }`. The filters are **only** `cause`,
`webhook_id` and `transformation_id`. Both `cause` and `webhook_id` accept a
string or an array.

On the `plan` endpoint the query goes in the query string as a nested object -
`?query[cause]=...&query[webhook_id]=...`. A JSON-encoded `query` parameter is
rejected with `422 query must be of type object`, which is worth knowing because
JSON is the obvious first guess.

### It can be scoped to exactly one machine - verified

```console
query[cause]=CLI_DISCONNECTED&query[webhook_id]=<build-a-01>  -> estimated_count 1
query[cause]=CLI_DISCONNECTED&query[webhook_id]=<build-a-02>  -> estimated_count 0
query[cause]=CLI_DISCONNECTED                                 -> estimated_count 1
```

So `cause` + `webhook_id` expresses "replay only what this machine missed
because it was disconnected" directly, and the healthy peers match nothing. That
is a better fit for the problem than retrying the request with `webhook_ids`,
which replays the request rather than the specific ignored events.

### Two sharp edges

**There is no time bound.** No `created_at` filter, no `request_id`. A job
scoped by cause and connection replays *everything* matching within retention,
not just what was missed during the incident. The request-retry approach can be
bounded with `--since`. For a machine that has been flaky for weeks this is a
meaningful difference.

**Omitting `cause` is dangerous.** `FILTERED` is also an ignored cause, so a
query scoped only by `webhook_id` replays events the connection deliberately
filtered out:

```console
query[webhook_id]=<build-b-01>   (no cause)  -> estimated_count 5
```

Those five are events that correctly did not match that machine's repo filter.
Replaying them would deliver work to a machine that was never meant to have it.
`cause` is not optional in practice.

### The job stalled - unresolved

The scoped job was accepted and then did not progress:

```console
POST /bulk/ignored-events/retry
  {"query":{"cause":"CLI_DISCONNECTED","webhook_id":"web_nySLNQcflZZv"}}
  200 {"id":"bch_4dti3WWKqr9U4g","estimated_count":1,"in_progress":true,"progress":0,...}
```

Seven minutes later: `in_progress: true`, `progress: 0`, `completed_count: 0`,
`failed_count: null`. The machine had reconnected at 17:52:19, 29 seconds before
the job was created at 17:52:48, so this is not the reconnect-ordering trap from
https://github.com/hookdeck/website/issues/736. `build-a-01` never received the
event.

Not yet diagnosed, and not yet filed - it needs a second reproduction before it
is worth reporting, since a single stalled batch job could be a transient worker
problem rather than a defect. But it matters for the recommendation: a recovery
script that cannot tell whether its own recovery succeeded is not something to
build a fleet on. The request-retry path returns the created events
synchronously.

### It does not cover the other half

Bulk ignored-events retry only touches ignored events, so it recovers
`CLI_DISCONNECTED` and does nothing for the `CLI_UNAVAILABLE` failed events from
inside the grace window. A complete recovery for one machine therefore needs
both paths:

- ignored events with cause `CLI_DISCONNECTED` -> bulk ignored-events retry
- events with status `FAILED` and error code `CLI_UNAVAILABLE` -> ordinary event
  retry

This is the main thing the current `recover.ts` gets wrong: it only looks for
ignored events.

## Leads from existing issues worth following up

Found while checking for duplicate issues; both affect the recovery script and
neither has been tested here.

- **`/bulk/ignored-events/retry`**, mentioned in
  https://github.com/hookdeck/website/issues/741, replays ignored events
  filtered by cause. That may be a cleaner recovery path than retrying the
  request with `webhook_ids`, and possibly one that avoids the duplicate problem
  by construction. **Unverified** - worth comparing against the current approach.
- **Reconnect before retrying.** https://github.com/hookdeck/website/issues/736
  notes that a retry re-evaluates the same "no attached session" condition, so
  retrying while the machine is still disconnected just produces another
  `CLI_DISCONNECTED`. `recover.ts` happens to do the right thing by being run
  after the machine is back, but that ordering is currently incidental rather
  than enforced, and should be made explicit.

## Open questions

### Is there a CLI sessions API? - pending, and it matters more than the rest

The 2.6.0 binary contains a `/2026-09-01/cli-sessions` endpoint:

```console
$ strings node_modules/hookdeck-cli/binaries/darwin-amd64/hookdeck \
    | grep -oE '/20[0-9]{2}-[0-9]{2}-[0-9]{2}/[a-z-]*' | sort -u
...
/2026-09-01/cli-sessions
/2026-09-01/connections
...
```

No CLI command exposes it - there is no `gateway session` or similar in
`hookdeck gateway --help` or `hookdeck --help` on 2.6.0 (both checked).

This is worth resolving before the recommendation is presented, because "we
don't expose sessions in the dashboard or API" is load-bearing for approach 1's
visibility argument. If that endpoint lists the sessions attached to a
connection, then approach 2's worst problem - not knowing which machines are
connected - is partly addressable after all, and the argument has to be narrowed
to the two that would still stand: a miss is not recorded, and a retry cannot be
targeted.

**Pending**: `GET /2026-09-01/cli-sessions` with a project API key, with and
without a connection filter, while a known number of `listen` sessions are
attached. Do not repeat the "not exposed in the API" claim until this is
settled.

### Does a request still list `CLI_DISCONNECTED` after a successful targeted retry? - pending

Matters because if it does, a recovery script keyed only on the ignored event
would retry the same request forever. `recover.ts` already guards against this
by skipping requests that have an event on the connection, and
`scenario -- down-long` runs recovery twice in a row to show whether the guard
is load-bearing.

### Does `webhook_ids` targeting work when the only ignored cause is `CLI_DISCONNECTED`, and is the new event delivered? - pending

### What happens to events during the grace window? - answered, see above

Scenario 3.

### Can `CLI_DISCONNECTED` requests be found without fetching ignored events per request? - pending

To check: whether `GET /requests` accepts an undocumented ignored-cause or
connection filter, and what the dashboard sends when filtering by it.

### Does a GITHUB source verify `X-Hub-Signature-256`, and does the forwarded request keep the original headers and raw body? - answered, see above

The harness is in place: `send-webhook.ts` records the sha256 of the exact
bytes posted to `logs/sent.jsonl`, and each machine records the sha256 of the
body it received to `logs/<approach>.<machine>.jsonl`, along with every header.
Comparing the two answers the byte-for-byte question without needing a real CI
server. Running one would additionally confirm that its own signature check
passes against the forwarded request.

## Product issues hit while building

Nothing that blocked the build. Observations worth passing on:

- The npm CLI shim forwards no signals, so `hookdeck listen` cannot be shut
  down gracefully by a process manager. Details above. This is the most
  consequential issue found, because it turns every managed restart into a
  crash.
- `hookdeck gateway request ignored-events` omits the `cause` field, so the CLI
  cannot distinguish `FILTERED` from `CLI_DISCONNECTED`. Filed as
  https://github.com/hookdeck/hookdeck-cli/issues/430. This is why the demo
  reads ignored events from the API rather than the CLI.
- `hookdeck gateway connection upsert` prints "Connection created successfully"
  even when it updated an existing connection. The behavior is correct (same ID,
  properties updated) but the message is wrong, and on an idempotent
  run-every-boot script it is the opposite of reassuring. CLI 2.6.0.
- `webhook_ids` on `POST /requests/{id}/retry` is not in the public API
  reference, but it is the only way to do duplicate-free per-machine recovery.
  It should be documented.
- The docs say issue triggers are not available for CLI destinations, but
  delivery issues are auto-created for them. Either the behavior or the doc is
  wrong.
- There is no way to list or count the CLI sessions attached to a connection.
  This is the root cause of every approach 2 limitation.
- `GET /requests` has no filter for ignored-event cause or connection, so
  finding what a given machine missed is list-then-fetch-per-request.
- Events are not created when a CLI destination has no session attached, where
  an HTTP destination would queue and retry. That is the underlying gap behind
  all of this.
