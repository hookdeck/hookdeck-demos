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
created an event and tried to deliver it.

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
only its link to Hookdeck is gone, which is what a flapping VPN or a sleeping
laptop looks like. Send a push, then click **Online**.

The event arrives on reconnect, with no recovery involved. The session was
never dropped, so Hookdeck still had somewhere to deliver it. Worth showing
because it is the most common kind of "down" and the one that needs no script -
it separates a genuine outage from a blip.

## 10. The harder case

Crash it again and leave it down **past two minutes**, then send. This time
there is no session at all, so **no event is created** - the request records a
`CLI_DISCONNECTED` ignored event against that connection.

That is the case nothing can retry on its own, because there is nothing to
retry. Bring the machine back and let recovery run, or show it by hand:

```bash
npm run recover -- group-a-host-03 --dry-run
npm run recover -- group-a-host-03
```

It goes back to the request and retries it scoped to that connection alone.
Same outcome, different mechanism, and the machine catches up without its peers
seeing anything twice.

Steps 7 and 10 are the same failure separated only by the clock. Worth saying
out loud, because it is the thing people get wrong.

## 11. Optional contrast

Switch the viz to comparison mode and repeat the crash. Under one connection
per group the request records a normal delivery: two of three sessions took it,
the destination was reachable, and nothing anywhere says a machine missed
anything. Then `npm run group-recovery-problem -- group-a --retry` shows the
only available fix duplicating to the healthy peers.

## If it runs long

Cut steps 4 and 6. Steps 7 through 10 are the argument and cannot be cut - the
recovery in 9 and 10 is the reason for the whole design.
