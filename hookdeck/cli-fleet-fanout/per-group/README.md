# Approach 2: one connection + CLI destination per group

One source. One connection and one CLI destination per group. Every machine in
the group runs `hookdeck listen` against the *same* connection.

```
                                                      ┌─ listen :4201 ──> local service
source ──> filter repository ──> fleet-demo-group-a ──┼─ listen :4202 ──> local service
           full_name in group-a                       └─ listen :4203 ──> local service
```

Hookdeck creates one event per matching session, and sessions do not compete,
so all three machines receive every matching event. The fan-out requirement is
met with one connection per group instead of one per machine.

That is the only thing this approach saves, and it saves less than it looks.
Connections are unlimited and unbilled, and the event count is identical - one
event per machine either way - so the saving is a handful of config entries, in
exchange for everything below.

```bash
npm run ensure:group -- group-a
npm run fleet -- up per-group
```

## What it costs

Hookdeck sees one connection, not N machines. Sessions are not exposed in the
dashboard or the API, so:

- **You cannot tell which machines are attached.** Three sessions and two
  sessions look the same from outside.
- **Nothing records a miss.** If one machine is down while its peers are up,
  the request has a perfectly normal delivered event on the group connection.
  There is no `CLI_DISCONNECTED` - the destination *was* reachable, just not by
  every machine. The miss is only visible by diffing the machines' own logs,
  which Hookdeck cannot do for you.
- **A retry cannot be aimed at one machine.** The connection is the group, so a
  retry creates an event for every session attached at that moment. The
  machines that already had the event get it again.

Only when *every* machine in the group is down does the request record
`CLI_DISCONNECTED` against the group connection - and then a retry is safe only
if all of them are back.

## Seeing it

```bash
npm run group-recovery-problem -- group-a
npm run group-recovery-problem -- group-a --retry
```

The first reads each machine's own log, shows which machine is behind, and then
shows that nothing in Hookdeck's record distinguishes that case. The second
performs the group retry and counts the duplicates it causes.

## The only workaround

Each machine tracks the last event it received and fetches newer ones itself.
That moves the problem into every machine: each one needs credentials, a
watermark, and dedup logic, and the whole point of the CLI destination was to
avoid writing that. Approach 1 gets the same result from one retry call.
