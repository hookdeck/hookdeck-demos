// The salon's diary: a week view built from the conversations the app has stored. Nothing here is sent anywhere;
// the page reads each conversation's post-call analysis and places a slot when the evaluation `booking_made` is
// success. Loaded as a plain script in the page (window.Diary) and with require() in the tests.
//
// requested_time is free text written by the agent's analysis ("Friday 3 pm", "Saturday morning", "tomorrow at 10"),
// so it is read, not trusted. A booking whose day and time of day cannot both be read goes in the unscheduled list
// with the text as it was received. A slot is never guessed.
(function (root) {
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // the salon works Monday to Saturday
  const DAY_WORDS = [
    ['mon', 0], ['monday', 0], ['tue', 1], ['tues', 1], ['tuesday', 1], ['wed', 2], ['weds', 2], ['wednesday', 2],
    ['thu', 3], ['thur', 3], ['thurs', 3], ['thursday', 3], ['fri', 4], ['friday', 4], ['sat', 5], ['saturday', 5],
    ['sun', 6], ['sunday', 6],
  ];
  const DAY_INDEX = new Map(DAY_WORDS);

  const text_of = (value) => (value == null || typeof value === 'object' ? '' : String(value).trim());

  /** Day of the week as 0 = Monday ... 6 = Sunday, or null. "today" and "tomorrow" need the call's start time. */
  function readDay(text, start_secs) {
    const named = /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/.exec(text);
    if (named) return DAY_INDEX.get(named[1]);
    const relative = /\b(today|tomorrow)\b/.exec(text);
    if (relative && Number.isFinite(start_secs)) {
      const called_on = (new Date(start_secs * 1000).getDay() + 6) % 7;
      return (called_on + (relative[1] === 'tomorrow' ? 1 : 0)) % 7;
    }
    return null;
  }

  /** Minutes after midnight, or null. A bare hour without am/pm is read against the salon's hours (9 to 6). */
  function readMinutes(text) {
    if (/\b(noon|midday)\b/.test(text)) return 12 * 60;
    if (/\d\s*(?:a\.?m\.?|p\.?m\.?)?\s*[-\u2013]\s*\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/.test(text)) return null; // "2-3pm" is a range: not one time to book
    const clock = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d:])/g;
    let match;
    while ((match = clock.exec(text))) {
      const [, h_text, m_text, meridiem] = match;
      const after = text.slice(match.index + match[0].length);
      if (/^(st|nd|rd|th)\b/.test(after)) continue; // "the 3rd" is a date, not a time
      // "14 November", "11/20" and "20-11" are dates: a number followed by a month name, "/" or "-" is never an hour
      if (/^(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(after) || /^[/\-\u2013]/.test(after)) continue;
      let hour = Number(h_text);
      const minute = m_text == null ? 0 : Number(m_text);
      const explicit = meridiem != null || m_text != null || /\bat\s*$/.test(text.slice(0, match.index)) || /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*$/.test(text.slice(0, match.index));
      if (!explicit || minute > 59) continue;
      if (meridiem) {
        if (hour < 1 || hour > 12) continue;
        hour = (hour % 12) + (meridiem[0] === 'p' ? 12 : 0);
      } else if (hour >= 1 && hour <= 8) hour += 12;
      else if (hour === 0 && m_text == null) continue;
      if (hour > 23) continue;
      return hour * 60 + minute;
    }
    return null;
  }

  /** What the page can read from requested_time: { day, minutes, part }, each null when not given. */
  function parseRequestedTime(raw, start_secs) {
    const text = text_of(raw).toLowerCase();
    const minutes = readMinutes(text);
    const part = /\bmorning\b/.test(text) ? 'morning' : /\bafternoon\b/.test(text) ? 'afternoon' : null;
    return { day: readDay(text, start_secs), minutes, part };
  }

  const clock_label = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  /** The booking a conversation made, or null when it made none. `slot` is null when the time cannot be placed. */
  function bookingOf(conversation) {
    const booked = conversation.evaluation_criteria_results && conversation.evaluation_criteria_results.booking_made;
    if (!booked || booked.result !== 'success') return null;
    const collected = conversation.data_collection_results || {};
    const value = (key) => text_of(collected[key] && collected[key].value);
    const raw = value('requested_time');
    const read = parseRequestedTime(raw, conversation.start_time_unix_secs);
    // An hour decides morning or afternoon; without one the caller must have said "morning" or "afternoon"
    const period = read.minutes != null ? (read.minutes < 12 * 60 ? 'morning' : 'afternoon') : read.part;
    const placed = read.day != null && read.day < DAYS.length && period != null;
    return {
      conversation_id: conversation.conversation_id,
      name: value('caller_name') || 'Caller',
      service: value('requested_service'),
      requested_time: raw,
      slot: placed ? { day: read.day, period, minutes: read.minutes } : null,
    };
  }

  /** The diary for a list of stored conversations: slots by day and period, plus the bookings that cannot be placed. */
  function build(conversations) {
    const slots = [];
    const unscheduled = [];
    for (const conversation of conversations) {
      let booking = null;
      try { booking = bookingOf(conversation); } catch { /* an odd stored record is left out, not fatal */ }
      if (!booking) continue;
      (booking.slot ? slots : unscheduled).push(booking);
    }
    const by_time = (a, b) => (a.slot.minutes ?? 24 * 60) - (b.slot.minutes ?? 24 * 60);
    slots.sort(by_time);
    return { days: DAYS, slots, unscheduled, booked: slots.length + unscheduled.length };
  }

  /** "Fri 15:00" or "Fri afternoon" for a placed booking, for the chip on its conversation. */
  function slotLabel(booking) {
    if (!booking || !booking.slot) return '';
    const { day, period, minutes } = booking.slot;
    return `${DAYS[day]} ${minutes != null ? clock_label(minutes) : period}`;
  }

  const api = { DAYS, parseRequestedTime, bookingOf, build, slotLabel, clockLabel: clock_label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Diary = api;
})(typeof window !== 'undefined' ? window : globalThis);
