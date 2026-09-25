# Demo walkthrough

Driven from the visualization (`npm run viz`) with the Hookdeck dashboard in a
second tab. Roughly 6 minutes. The argument is that one connection per machine
gives you a record of every miss and recovery without duplicates; everything
below builds to that.

## 1. Start from nothing

Open the viz. Click **Teardown** so the project is empty and the picture shows
the source with no routes. Starting from zero makes the setup step meaningful
and proves the demo is not pre-baked.

## 2. Walk through `scenarios/fleet.yaml`

Put the file on screen. This is the whole configuration, and it maps one-to-one
onto Hookdeck:

- **groups and hosts** - who must receive what
- **sources** - where webhooks arrive
- **connections** - one per machine, each naming its source, its CLI
  destination and path, the host that listens on it, and the filter

Point at the three `group-a` connections carrying the same filter. That is why
all three hosts get the same events, and it is the only routing rule involved.
Then point at `group-b`: a group of one, same shape, which is how "these
webhooks go to this machine and nothing else" is expressed.

## 3. Setup

Click **Setup**. The viz fills in: connections appear, and a CLI session starts
on each. Say that this is `connection upsert`, that it is idempotent, and that
it is what a machine would run at launch.

## 4. Show the dashboard

Switch to the Hookdeck dashboard, connections filtered to the per-machine ones.
Four connections, named for the machines. This is the visibility claim made
concrete: the fleet is legible in Hookdeck before anything has been delivered.

## 5. Send an event

Back to the viz. **Send** a push for `demo-org/service-api`. It flows from the
source to all three `group-a` hosts. Three connections matched, three events,
one per machine.

## 6. Send an event the group does not want

Send a push for `demo-org/release-tooling`. Only `group-b-host-01` lights up.
The `group-a` connections record `FILTERED` - they were considered and
correctly skipped. Routing is per connection, and you can see the decision.

## 7. Crash a machine

Open the host menu on the Setup row, choose **group-a-host-03**, and click **Crash**. This is `kill -9` on the process group, so the
listener dies with no chance to close its WebSocket - a crash, not a shutdown.

Send another push **within two minutes**. Two hosts receive it. The third does
not, and the event against its connection is `FAILED` with `CLI_UNAVAILABLE`:
the session was still held open by the reconnect grace window, so Hookdeck
created an event and tried to deliver it. Give it ten seconds before you look -
until then it is still retrying, and the status has not settled.

## 8. Show it in the dashboard

The failed event, named against `group-a-host-03`. Nothing has to be inferred
from logs - Hookdeck knows which machine missed which event, because that
machine is a connection.

## 9. Bring it back

Back to the viz, start the machine. When its CLI session reconnects,
`machine.ts` runs recovery for that connection: it finds what this machine
missed and replays only that. The host catches up; the two healthy peers do not
move. No duplicates, no manual step.

## 9b. The case that needs nothing

Select `group-a-host-03` and click **Offline**. The machine is still running -
only its link to Hookdeck is gone. The listener's sockets are destroyed and
new connections refused, so the CLI really does lose its connection and
reconnect when you restore it. Send a push, then click **Online**.

If you restore it within about ten seconds, the event arrives with no recovery
involved: Hookdeck waits roughly that long for a session to come back before
giving up on a delivery. Leave it longer and the attempt is finalized, and
recovery replays it when the machine reconnects.

Worth showing because it separates a blip, which needs nothing, from an outage,
which needs the script - and the boundary is seconds, not minutes.

## 10. The case that needs recovery

Set the **session** toggle to **Disconnected**. This stops `hookdeck listen`
cleanly while the machine keeps running, so the WebSocket closes and Hookdeck
drops the session immediately - no waiting for a grace window.

Send a push. This time there is no session at all, so **no event is created**:
the request records a `CLI_DISCONNECTED` ignored event against that
connection. Show it in the dashboard next to the two that succeeded.

Set the session back to **Connected**. The machine reconnects and recovery
runs: it goes back to the request and retries it scoped to this connection
alone, so the machine catches up and its peers see nothing.

```
SESSION starting hookdeck listen
LISTEN Connected. Waiting for events...
Recovering group-a-host-03
  retried request req_gs5Pup1ijiB8LqaTVfU7 -> 1 event(s)
RECV push repo=demo-org/service-api delivery=792f1cc0-...
```

Steps 9b and 10 are the same machine unavailable in two different ways, and
what separates them is how long. A link cut and restored inside about ten
seconds needs nothing: Hookdeck is still retrying, and the event lands. Past
that the attempt is finalized, and only a targeted retry brings the machine
back in line. That is why a connection per machine matters: the retry could be
aimed at this machine alone.

Crashing, waiting out the two-minute window and *then* sending reaches the same
place, but costs two minutes of silence on camera. Use `disconnect` unless the
grace window itself is the point.

## 11. Optional contrast

Switch the viz to comparison mode and repeat the crash. Under one connection
per group the request records a normal delivery: two of three sessions took it,
the destination was reachable, and nothing anywhere says a machine missed
anything. Then `npm run group-recovery-problem -- group-a --retry` shows the
only available fix duplicating to the healthy peers.

## If it runs long

Cut steps 4 and 6. Steps 7 through 10 are the argument and cannot be cut - the
recovery in 9 and 10 is the reason for the whole design.
