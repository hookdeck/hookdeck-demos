# Connection per machine (recommended)

*The approach this demo recommends. See the [README](../README.md) for why.*

One source. One connection and one CLI destination per machine. Machines in the
same group carry the same body filter, so all of them match the same events and
all of them receive every one. The one-to-one machine is a group of one with
its own filter.

```
                                  ┌─ fleet-demo-group-a-host-01 ──> listen :4101 ──> local service
source ──> filter repository ─────┼─ fleet-demo-group-a-host-02 ──> listen :4102 ──> local service
           full_name in group-a   └─ fleet-demo-group-a-host-03 ──> listen :4103 ──> local service

       ──> filter repository ─────── fleet-demo-group-b-host-01 ──> listen :4104 ──> local service
           full_name in group-b
```

## Why this one

Hookdeck does not expose CLI sessions in the dashboard or the API. Modeling
each machine as its own connection is what makes the fleet visible: the
connection *is* the machine.

That gives three things a connection per group cannot:

1. **You can see which machines are configured**, and each one's delivery
   history is its own.
2. **A miss is recorded.** When a machine is down, the request gets a
   `CLI_DISCONNECTED` ignored event against that machine's connection. When one
   machine is down and its peers are up, a connection per group records nothing at all.
3. **Recovery targets one machine.** A retry can be scoped to a single
   connection, so the machine that missed catches up and its peers see no
   duplicate.

None of that is bought by spending connections. The per-machine connection *is*
the record: it is the thing Hookdeck attributes a delivery, or a miss, to. There
is no per-connection charge and no cap - connections are unlimited on every plan
- and both approaches create one event per machine, so a given fleet costs the
same in the billed unit either way.

What it does cost is config surface: one entry per machine to keep in sync
rather than one per group. `fleet.yaml` and an idempotent upsert on launch are
what keep that from being toil.

## At machine launch

`ensure-connection.ts` is the script a machine runs on boot. It is idempotent,
so it is safe on every boot, on a redeploy, and when the fleet definition
changes.

```bash
npm run ensure:machine -- group-a-host-01 --dry-run
npm run ensure:machine -- group-a-host-01
npm run fleet -- up per-machine group-a-host-01
```

It runs one `PUT /connections`, which creates the connection the first time
and afterward updates the rules and description. The
connection must exist before `listen` runs - see the note about `cli-<source>`
in the root README.

In production this is the machine's launch script: read its entry from
`fleet.yaml`, upsert, then exec `hookdeck listen`.

## Recovery

Coming back up runs this once `hookdeck listen` reports that it is connected.
The same recovery can be run by hand:

```bash
npm run recover -- group-a-host-01 --dry-run
npm run recover -- group-a-host-01
```

1. List the source's requests since a time bound. The request list cannot be
   filtered by ignored-event cause or by connection, so the bound is what keeps
   this cheap.
2. For each request, fetch its ignored events and keep those with cause
   `CLI_DISCONNECTED` on this machine's connection.
3. Skip any request that already has an event on this connection, so a re-run
   does not deliver the same webhook twice.
4. Retry the rest with `webhook_ids` set to just this connection.

Step 3 exists because a retried request can still list its original
`CLI_DISCONNECTED` ignored event - the ignored record alone is not proof the
machine still needs it.

The equivalent by hand:

```bash
hookdeck gateway request list --source-id src_... --created-after 2026-09-23T10:00:00Z
hookdeck gateway request ignored-events req_...
hookdeck gateway request retry req_... --connection-ids web_...
```
