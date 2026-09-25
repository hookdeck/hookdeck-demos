# Delivering webhooks to machines on a private network

*Several machines need the same event, none of them can be reached from the
internet, and you need to know when one of them didn't get it.*

Machines sit on a private network with no inbound route. They are arranged in
groups, and every machine in a group must receive every event for that group -
they are peers, not workers sharing a queue. Some groups are a single machine
that receives only its own repositories' events.

`hookdeck listen` solves the connectivity problem: each machine dials out, and
Hookdeck pushes events down that connection to a local port. What's left is how
to *model* the fleet in Hookdeck, and that choice decides what you can see and
recover when a machine dies.

## The approach: one connection per machine

Give every machine its own connection and CLI destination. Machines in the same
group share a filter, so all of them match the same events.

![One connection per machine. group-a-host-03 drops and the request records CLI_DISCONNECTED. The host comes back, and that event is retried onto its connection only.](viz/per-machine.gif)

A connection is the unit Hookdeck records delivery against. Making each machine
a connection is what gives you, for free:

- **Visibility** - each machine is a named connection with its own delivery history.
- **A record of every miss** - a machine that is down gets `CLI_DISCONNECTED` on
  its own connection, so the request says exactly who missed what.
- **Recovery without duplicates** - a retry can be scoped to one connection, so
  the machine that missed catches up and its peers see nothing.

It costs one connection per machine rather than one per group. Connections are
unlimited on every plan, and both models create one event per machine, so the
event count is identical. The real cost is config surface, which is what
the scenario file and an idempotent upsert on machine launch are for.

## How the config maps

[`scenarios/fleet.yaml`](scenarios/fleet.yaml) is the source of truth and maps one-to-one onto
Hookdeck. Groups and hosts at the top, then the sources and connections that
`npm run setup` upserts exactly as written:

```yaml
filters:
  group-a:                                     # a group IS a filter
    repository:
      full_name:
        $in: [demo-org/service-api, demo-org/service-worker]

connections:
  - name: fleet-demo-group-a-host-01           # the Hookdeck connection
    source: fleet-demo-per-machine             # the Hookdeck source
    destination:
      name: fleet-demo-group-a-host-01         # the CLI destination
      type: CLI
      path: /webhooks/scm                      # where the machine serves
    hosts: [{ host: group-a-host-01, port: 4101 }]
    filter: group-a                            # why this machine gets the event
```

Three connections name the same filter, and that *is* the group - the machines
receiving the same events are the machines sharing a filter. Nothing declares
group membership separately, and a repository appears in exactly one place.
`group-b` is the one-to-one case: one connection on that filter, same shape.

## How connections get created

Two ways, and they are the same call. `ensureMachineConnection` upserts one
machine's connection; `npm run setup` runs it for every machine in the
scenario.

**Centrally**, which is what `setup` and the visualization's Setup button do -
one place provisions the whole fleet.

**Or each machine registers itself** at launch, which is what production looks
like: nothing has to know the fleet exists in advance, and adding a machine is
booting it.

```bash
FLEET_SELF_REGISTER=1 npm run fleet -- up per-machine
```

The machine ensures its own connection, then starts listening:

```
REGISTER ensuring fleet-demo-group-a-host-02 exists before listening
REGISTER fleet-demo-group-a-host-02 ready
READY machine=group-a-host-02 ... connection=fleet-demo-group-a-host-02
```

`connection upsert` is idempotent, so this is safe on every boot and on a
redeploy.

It **fails closed**: if the upsert fails, the machine exits rather than
listening. That matters more than it looks. `listen` creates a connection
called `cli-<source>` when it finds none for the source, so a machine that
listened anyway would attach there - and so would every other machine,
silently collapsing one connection per machine into one per group.

Note this is a property of *provisioning*, not of the model. It changes who
makes the call, not what Hookdeck records, so it is not a third approach. It
also only applies to one connection per machine: under one connection per
group, N machines would race to own one shared connection, and a machine
booting from a stale config would quietly rewrite the filter for all its peers.
Those connections are provisioned centrally.

## Run it

```bash
npm install                        # brings a pinned hookdeck-cli with it
cp .env.example .env               # HOOKDECK_API_KEY + GITHUB_WEBHOOK_SECRET
npm run viz                        # default scenario, then open the printed URL
npm run viz -- --scenario multi-region
```

`.env` wants a project API key for a **dedicated Event Gateway test project**.
The demo authenticates into its own `run/hookdeck-cli.toml`, so it never
touches the project you are logged into interactively, and every resource it
creates is named with that scenario's prefix so teardown can find them. The
default prefix is `fleet-demo`.

The visualization drives the real fleet for the scenario you started. It draws
every group in that file, and the frame grows with the hosts. **Setup** upserts
the connections and starts a CLI session on each, **Send** posts a signed
webhook. The host menu on the Setup row picks a machine; **Up**, **Down**, and **Crash** apply to that host. The selected host and each menu entry show whether it is up or down. **Teardown**
removes everything. The animations above are the default scenario,
`scenarios/fleet.yaml`, and only its group of three. `scenarios/multi-region.yaml` is a
larger fleet: `npm run viz -- --scenario multi-region`.

Prefer the terminal? `npm run setup`, then `npm run fleet -- up per-machine`,
then `npm run send -- --approach per-machine --repo demo-org/service-api`.

Working on the visualization itself? `npm run viz:watch` restarts the server
when a `.ts` file changes and reloads the page when `index.html`, `scene.js` or
the scenario YAML does. It is deliberately not the default - a page reloading
itself partway through a demo is the last thing you want.

[WALKTHROUGH.md](WALKTHROUGH.md) is the demo script for showing this to someone.

## When a machine goes down

Three different things get called "down", and they behave differently. What
separates them is whether the CLI *session* survives.

| | `offline` | `crash`, back inside ~2 min | `crash`, back later |
|---|---|---|---|
| What happened | link lost, process alive | process gone | process gone |
| Session | same one, reconnects | dropped, new one on return | gone |
| Event | delivered on reconnect | created, then `FAILED` with `CLI_UNAVAILABLE` | **never created** |
| Recorded as | a normal delivery | an event on that connection | `CLI_DISCONNECTED` ignored event |
| Recovered by | nothing needed | retrying the event | retrying the request, scoped to that connection |

The first column is the common case in practice - a flapping VPN, a sleeping
laptop, a brief network partition - and it self-heals. Try it:

```bash
npm run fleet -- offline per-machine group-a-host-03
npm run send   -- --approach per-machine --repo demo-org/service-api
npm run fleet -- online  per-machine group-a-host-03
```

The log shows the link go, the event arrive on reconnect, and the session come
back - without any recovery running:

```
OFFLINE link lost listener pid 15088
ONLINE link restored listener pid 15088
LISTEN Connection lost, reconnecting...
RECV push repo=demo-org/service-api delivery=53bb53e1-... event=evt_h4YCLSO2sFd73Rdiec
```

The other two columns do need recovery, and get it automatically: when a
machine's CLI session reconnects, `machine.ts` runs `recoverMachine()`, which
finds what that connection missed and replays only that - failed events by event
retry, never-created events by a request retry scoped to its connection. Nothing
reaches its peers.

**Your handler needs to be idempotent.** That is true of any webhook consumer,
and it is true here: an attempt can time out from Hookdeck's side after the CLI
has already delivered locally, so a later retry can deliver the same event
again. Deduplicate on `X-GitHub-Delivery`, or on the Hookdeck event id in
`X-Hookdeck-Eventid`. The demo does not do this for you - the stub server
records every delivery it gets, precisely so duplicates are visible rather than
hidden.

Run it by hand to watch it work:

```bash
npm run recover -- group-a-host-01 --dry-run
npm run recover -- group-a-host-01
```

It skips requests that already have a successful event on the connection, so
re-running it is safe. The last run is recorded in
`run/recover.<machine>.json` and used as the next `--since`.

## How CLI destinations behave

Worth knowing before you rely on any of this. Verified against
`hookdeck-cli@2.6.0` and API `2026-09-01`.

- A CLI destination delivers only to sessions attached **at the time**. Events
  arriving while nothing is listening are not queued.
- A clean shutdown (Ctrl+C, SIGINT) closes the WebSocket and drops the session
  **immediately**. An abnormal exit holds it for about 2 minutes. That is the
  difference between the two columns above, so how you stop `listen` changes
  what happens to events sent moments later.
- Several sessions on one connection produce **one event per session**. Sessions
  do not compete.
- `CLI_UNAVAILABLE` is an attempt error code on an event that exists.
  `CLI_DISCONNECTED` is an ignored-event cause where no event was created. Only
  the second means there is nothing to retry.
- Sessions are not exposed in the dashboard or API, which is the root of every
  limitation in the alternative below.
- The forwarded request keeps the original body byte for byte and the original
  `X-Hub-Signature-256`, so a receiver's existing signature check still passes.

## The alternative: one connection per group

Every machine in the group runs `listen` against the *same* connection.
Hookdeck creates one event per attached session, so the fan-out requirement is
still met with fewer connections.

![One connection per group. The request records a normal delivery. Bringing the down host back does not fetch the event it missed.](viz/per-group.gif)

It is here to show the trade, not as a recommendation. Because Hookdeck sees
one connection rather than N machines:

- You cannot tell which machines are attached. Three sessions and two look identical.
- **Nothing records a miss.** If one machine is down while its peers are up, the
  request has a perfectly normal delivered event. The destination *was*
  reachable - just not by every machine.
- A retry cannot be aimed at one machine, so it duplicates to everyone still attached.

Only when the whole group is down does the request record `CLI_DISCONNECTED`,
and then a retry is safe only once all of them are back.

```bash
npm run group-recovery-problem -- group-a            # show the divergence
npm run group-recovery-problem -- group-a --retry    # and the duplicates a retry causes
```

## Commands

```bash
npm run setup [-- --dry-run]                    # upsert everything in the scenario
npm run viz                                     # live visualization + controls
npm run viz:watch                               # same, restarting on file changes
npm run fleet -- up|down|crash|offline|online <approach> [host]
npm run fleet -- status|logs <approach> [host]
npm run send -- --approach <a> --repo <r> [--event push] [--count N]
npm run inspect -- --approach <a>               # per request, what each connection did
npm run recover -- <host> [--since <iso>] [--dry-run]
npm run scenario -- list                        # scripted end-to-end scenarios
npm run teardown [-- --dry-run]
```

Both models use separate sources and ports, so they run side by side:
`npm run fleet -- up per-group` alongside `per-machine`, then
`npm run send -- --approach both`.

`setup` writes resolved Hookdeck IDs to `run/setup.json`, which is deliberately
not in source control - those IDs are per project and stale after any teardown.
The scenario file belongs in git; `setup` re-derives the rest in
seconds.

## Layout

```
scenarios/fleet.yaml                  filters, sources, connections, approaches
scenarios/multi-region.yaml           a second fleet, same shape
viz/                                  live visualization, shared renderer, GIF capture
shared/src/config.ts                  loads the scenario
shared/src/hookdeck.ts                Hookdeck API client + CLI wrapper
shared/src/machine.ts                 one simulated machine: stub server, listener, startup recovery
shared/src/fleet.ts                   process manager: up, down, crash, status, logs
shared/src/send-webhook.ts            signed GitHub-shaped webhook sender
shared/src/inspect.ts                 per-request, per-connection outcomes
shared/src/setup.ts, teardown.ts      create and remove everything by prefix
shared/src/scenario.ts                scripted scenarios + transcripts
per-machine/src/                      connection per machine: upsert, targeted recovery
per-group/src/                        connection per group: upsert, why recovery cannot work
```

## Gotchas

- Create connections **before** running `listen`. If `listen` finds no
  connection for a source it creates one called `cli-<source>`, and every later
  `listen` on that source attaches to it - silently collapsing one connection
  per machine into one per group.
- Pass the exact connection name to `listen`. The argument also matches a
  substring of the CLI path, so `/webhooks/scm` would match every connection
  whose path contains it.
- Never use `listen --path`. It writes the path to the server and it persists.
  Set it with `--destination-cli-path` on the connection.
- Signals: the npm shim does not forward them
  ([#429](https://github.com/hookdeck/hookdeck-cli/issues/429)), so the demo
  runs the platform binary directly. Without that, a clean stop behaves like a
  crash.
