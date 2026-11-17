import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConversationRecord } from '../src/events';
import { transcriptionEvent } from '../src/samples';
import { Store } from '../src/store';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// public/diary.js is a plain script for the page that also exports itself for require()
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Diary = require('../public/diary.js');

// A Friday morning, so "today" and "tomorrow" resolve to Friday and Saturday
const FRIDAY_NOON = Math.floor(new Date(2026, 10, 20, 12, 0, 0).getTime() / 1000);

function conversation(requested_time: unknown, booking: string | null = 'success', extra: Partial<ConversationRecord> = {}) {
  return {
    conversation_id: `conv_${Math.random().toString(36).slice(2, 8)}`,
    start_time_unix_secs: FRIDAY_NOON,
    data_collection_results: {
      caller_name: { value: 'Sam' },
      requested_service: { value: 'haircut' },
      requested_time: { value: requested_time },
    },
    evaluation_criteria_results: booking ? { booking_made: { result: booking } } : {},
    ...extra,
  };
}

describe('parseRequestedTime', () => {
  const read = (text: string) => Diary.parseRequestedTime(text, FRIDAY_NOON);
  it('reads a day and a clock time in the forms the agent writes', () => {
    for (const text of ['Friday 3 pm', 'Friday at 3pm', 'fri 15:00', 'Friday, 3:00 PM', 'Friday at 3']) {
      assert.deepEqual(read(text), { day: 4, minutes: 15 * 60, part: null }, text);
    }
    assert.equal(read('Friday 3:30 pm').minutes, 15 * 60 + 30);
    assert.equal(read('Saturday 9.30am').minutes, 9 * 60 + 30);
    assert.equal(read('Friday at noon').minutes, 12 * 60);
  });
  it('reads a bare hour against the salon hours: 9 to 11 is morning, 12 and 1 to 8 are afternoon', () => {
    assert.equal(read('Friday 10').minutes, 10 * 60);
    assert.equal(read('Friday 12').minutes, 12 * 60);
    assert.equal(read('Friday 5').minutes, 17 * 60);
  });
  it('reads a part of the day when there is no hour', () => {
    assert.deepEqual(read('Saturday morning'), { day: 5, minutes: null, part: 'morning' });
    assert.deepEqual(read('Friday afternoon'), { day: 4, minutes: null, part: 'afternoon' });
  });
  it('resolves today and tomorrow from the call start, and only then', () => {
    assert.equal(read('tomorrow at 10').day, 5);
    assert.equal(read('today 4pm').day, 4);
    assert.equal(Diary.parseRequestedTime('tomorrow at 10', undefined).day, null);
  });
  it('does not read a date, an out-of-range hour or empty text as a time', () => {
    assert.equal(read('the 3rd of March').minutes, null);
    assert.equal(read('Friday 30').minutes, null);
    assert.equal(read('Friday 13:75').minutes, null);
    assert.deepEqual(read(''), { day: null, minutes: null, part: null });
    assert.deepEqual(Diary.parseRequestedTime(null, FRIDAY_NOON), { day: null, minutes: null, part: null });
  });
});

describe('Diary.build', () => {
  it('places a booked slot in its day and period, with the time and the caller', () => {
    const diary = Diary.build([conversation('Friday 3 pm')]);
    assert.equal(diary.booked, 1);
    assert.equal(diary.unscheduled.length, 0);
    const [slot] = diary.slots;
    assert.deepEqual(slot.slot, { day: 4, period: 'afternoon', minutes: 900 });
    assert.equal(slot.name, 'Sam');
    assert.equal(slot.service, 'haircut');
    assert.equal(Diary.slotLabel(slot), 'Fri 15:00');
    assert.equal(Diary.DAYS[slot.slot.day], 'Fri');
  });
  it('puts a morning booking in the morning row, and a part of the day without an hour in its row', () => {
    const [am, part] = Diary.build([conversation('Tuesday 9:30 am'), conversation('Saturday afternoon')]).slots;
    assert.equal(am.slot.period, 'morning');
    assert.equal(part.slot.period, 'afternoon');
    assert.equal(Diary.slotLabel(part), 'Sat afternoon');
  });
  it('adds nothing when booking_made is not success, or is missing', () => {
    for (const booking of ['failure', 'unknown', null]) {
      const diary = Diary.build([conversation('Friday 3 pm', booking)]);
      assert.equal(diary.booked, 0, String(booking));
    }
    assert.equal(Diary.bookingOf({ conversation_id: 'c', evaluation_criteria_results: {}, data_collection_results: {} }), null);
  });
  it('never invents a slot: a time it cannot read goes in the unscheduled list with the text as received', () => {
    const cases = ['next Friday-ish', 'Friday', 'half past three on Friday', 'Sunday 11am', 'the 3rd of March', '', null];
    for (const requested_time of cases) {
      const diary = Diary.build([conversation(requested_time)]);
      assert.equal(diary.slots.length, 0, String(requested_time));
      assert.equal(diary.unscheduled.length, 1, String(requested_time));
      assert.equal(diary.unscheduled[0].requested_time, requested_time ?? '');
      assert.equal(diary.booked, 1);
    }
  });
  it('stacks two bookings in one slot in time order and keeps them apart from other slots', () => {
    const diary = Diary.build([conversation('Friday 3:30 pm'), conversation('Friday 3 pm'), conversation('Monday 10am')]);
    assert.deepEqual(diary.slots.map((b: any) => Diary.slotLabel(b)), ['Mon 10:00', 'Fri 15:00', 'Fri 15:30']);
  });
  it('falls back to "Caller" for a missing name and leaves the service blank', () => {
    const c = conversation('Friday 3 pm');
    delete (c.data_collection_results as any).caller_name;
    delete (c.data_collection_results as any).requested_service;
    const [b] = Diary.build([c]).slots;
    assert.equal(b.name, 'Caller');
    assert.equal(b.service, '');
  });
});

describe('the diary reads what the unchanged store keeps', () => {
  it('a stored sample transcription becomes a Friday 15:00 slot', () => {
    const data_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elevenlabs-diary-'));
    try {
      const store = new Store(data_dir);
      store.apply(transcriptionEvent('conv_diary') as any, 100);
      const diary = Diary.build(store.listConversations());
      assert.equal(Diary.slotLabel(diary.slots[0]), 'Fri 15:00');
      assert.equal(diary.slots[0].conversation_id, 'conv_diary');
    } finally {
      fs.rmSync(data_dir, { recursive: true, force: true });
    }
  });
});
