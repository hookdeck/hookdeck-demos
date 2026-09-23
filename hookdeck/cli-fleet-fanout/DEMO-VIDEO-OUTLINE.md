# 5-minute demo video outline

Audience: the engineers who run these machines. They already
believe the connectivity story works; what they need to see is what happens
when one of their machines dies.

Pre-record setup so the video opens on a working fleet: `npm run setup` done,
both approaches' connections created, terminal split into four panes tailing
`logs/per-machine.group-a-host-0{1,2,3}.log` and one pane to type in.

## 0:00 - 0:40  The problem

One sentence on the setup: machines on a private network, no inbound route,
groups of three or four where every machine must get every event.

Show `fleet.yaml` on screen. Point at the groups and hosts first: group-a's three
hosts, group-b's one host. Then the connections: one source, one CLI destination,
one filter, and the hosts that listen. This is the config that lives in source
control.

Say the thing that frames everything after it: there are two ways to model this
in Hookdeck, they look identical until a machine goes down, and that is what
the next four minutes are about.

## 0:40 - 1:30  Happy path

`npm run scenario -- happy-path --approach per-machine`

What to point at: all three group-a panes light up with the same
`X-GitHub-Delivery`, and `group-b-host-01` stays quiet until the `release-tooling` push,
which only it receives.

Proves: fan-out to every machine in a group works, and one-to-one routing
works. Both approaches do this, so do not dwell - this is the part they already
expect.

## 1:30 - 2:45  One machine dies (connection per machine)

`npm run fleet -- crash per-machine group-a-host-01` - say out loud that this is
`kill -9`, not a clean stop.

Send three pushes. Two panes light up, one stays dark.

`npm run inspect -- --approach per-machine` - this is the money shot. The
request lists a delivered event for `group-a-host-02` and `group-a-host-03`, and
`IGNORED CLI_DISCONNECTED` for `group-a-host-01`. Hookdeck knows exactly which
machine missed which event.

Bring it back, then `npm run recover -- group-a-host-01`.

Point at all four panes: `group-a-host-01` catches up, and the other two do not move.
No duplicates. That is the whole pitch.

## 2:45 - 3:45  The same failure with a connection per group

Same crash, same three pushes, against the group connection.

`npm run inspect -- --approach per-group` - one row, delivered. Nothing
anywhere says a machine missed anything. Let that sit for a second.

`npm run group-recovery-problem -- group-a` shows the divergence, but only
because it read the machines' own logs. Hookdeck cannot tell you this.

`npm run group-recovery-problem -- group-a --retry` and point at the duplicate
count on the two healthy machines.

Proves the two claims that decide the recommendation: the miss is invisible,
and the only available fix duplicates to everyone.

## 3:45 - 4:30  Operating it

Back to `fleet.yaml`. The connection is already written there: source, CLI
destination, filter, and the one host that listens. `ensure-connection.ts`
upserts that connection on boot, so adding a host is a pull request and a boot.

Run `npm run ensure:machine -- group-a-host-01` twice to show it is idempotent.

## 4:30 - 5:00  Close

The honest limitation, stated plainly: a CLI destination delivers only to
sessions attached at the time, so events arriving while a machine is down are
not queued the way an HTTP destination would queue them. A connection per machine is what
makes that recoverable rather than silent.

Then the ask: whether their groups look like `fleet.yaml`, and how they want
the launch script to fit their existing provisioning.

## If it runs long

Cut the operating section to a single `fleet.yaml` shot. The crash-and-recover
contrast between the two approaches is the only part that cannot be cut - it is
the entire argument.
