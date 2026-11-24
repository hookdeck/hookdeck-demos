/**
 * Closes the story when the last human has left. The agent stays in the room on purpose (closeOnDisconnect is false, so a player
 * who leaves doesn't end the story for the others), and the app keeps a soundtrack playing: both are participants, so LiveKit never
 * sees an empty room and never sends room_finished. After a short grace period (a refreshed page rejoins within it) the watcher
 * calls `onEmpty`, which stops the soundtrack and has the agent leave; LiveKit then closes the room after its departure timeout.
 */
export function createEmptyRoomWatcher(onEmpty: () => void, grace_ms = 10000, timers = { set: setTimeout, clear: clearTimeout }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    /** Call whenever a participant connects or disconnects, with how many humans are in the room now. */
    update(humans_here: number): void {
      if (humans_here > 0) {
        if (timer) timers.clear(timer);
        timer = undefined;
      } else if (!timer) {
        timer = timers.set(() => { timer = undefined; onEmpty(); }, grace_ms);
      }
    },
  };
}
