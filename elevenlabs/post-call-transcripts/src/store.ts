import * as fs from 'fs';
import * as path from 'path';
import {
  ConversationRecord,
  DeliveryRecord,
  ElevenLabsEvent,
} from './events';

const MAX_DELIVERIES = 200;
/** The oldest conversations (and their audio files) are dropped past this many, so a long-running demo does not fill the disk */
const MAX_CONVERSATIONS = 50;
const MAX_ID_LENGTH = 200;

/** The payload is not one this demo can store. The webhook handler answers it with a 400. */
export class InvalidEventError extends Error {}

const is_record = (value: unknown): value is Record<string, any> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const finite = (value: unknown): number | undefined => (value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined);

/** A file name for an ID: letters, digits and "-" as they are, every other byte as _XX, so two different IDs never share a file. */
function audioName(conversation_id: string): string {
  return `${conversation_id.replace(/[^A-Za-z0-9-]+/g, (run) => [...Buffer.from(run)].map((b) => `_${b.toString(16).padStart(2, '0')}`).join(''))}.mp3`;
}

/** Conversations and the delivery log, persisted as JSON under dataDir. */
export class Store {
  private conversations = new Map<string, ConversationRecord>();
  private deliveries: DeliveryRecord[] = [];
  /** `${type}:${conversation_id}` keys already processed */
  private processed = new Set<string>();

  constructor(private dataDir: string) {
    fs.mkdirSync(path.join(dataDir, 'audio'), { recursive: true });
    this.load();
  }

  private file(name: string) {
    return path.join(this.dataDir, name);
  }

  private load() {
    let raw: string;
    try {
      raw = fs.readFileSync(this.file('state.json'), 'utf-8');
    } catch {
      return; // First run: nothing saved yet
    }
    try {
      const saved = JSON.parse(raw);
      for (const record of saved.conversations || []) {
        this.conversations.set(record.conversation_id, record);
        this.renameOldAudio(record.conversation_id);
      }
      this.deliveries = saved.deliveries || [];
      this.processed = new Set(saved.processed || []);
    } catch (error) {
      // Not starting empty over it: the next save would replace the only copy
      const aside = this.file(`state.corrupt-${Date.now()}.json`);
      fs.renameSync(this.file('state.json'), aside);
      this.conversations.clear();
      console.error(`state.json could not be read (${(error as Error).message}); moved to ${aside} and starting empty`);
    }
  }

  /** Audio saved before file names were encoded was named with every other character as "_" */
  private renameOldAudio(conversation_id: unknown) {
    if (typeof conversation_id !== 'string') return;
    const old_file = path.join(this.dataDir, 'audio', `${conversation_id.replace(/[^A-Za-z0-9_-]/g, '_')}.mp3`);
    const new_file = this.audioPath(conversation_id);
    if (old_file !== new_file && fs.existsSync(old_file) && !fs.existsSync(new_file)) fs.renameSync(old_file, new_file);
  }

  /** Writes the state to a temporary file and renames it over state.json, so a crash mid-write cannot leave half a file */
  save() {
    const state = {
      conversations: [...this.conversations.values()],
      deliveries: this.deliveries,
      processed: [...this.processed],
    };
    const temp = this.file(`state.json.${process.pid}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, this.file('state.json'));
  }

  /** Idempotency key: one stored result per event type per conversation. */
  static key(event: ElevenLabsEvent): string {
    return `${event.type}:${event.data.conversation_id}`;
  }

  hasProcessed(event: ElevenLabsEvent): boolean {
    return this.processed.has(Store.key(event));
  }

  listConversations(): ConversationRecord[] {
    return [...this.conversations.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  getConversation(id: string): ConversationRecord | undefined {
    return this.conversations.get(id);
  }

  listDeliveries(): DeliveryRecord[] {
    return this.deliveries;
  }

  logDelivery(record: DeliveryRecord) {
    this.deliveries.unshift(record);
    this.deliveries.length = Math.min(this.deliveries.length, MAX_DELIVERIES);
    this.save();
  }

  audioPath(conversation_id: string): string {
    return path.join(this.dataDir, 'audio', audioName(conversation_id));
  }

  /**
   * Merges an event into the conversation it belongs to. Events for one conversation
   * can arrive in any order (the audio before the transcription, for example), so each
   * type only writes its own fields.
   */
  apply(event: ElevenLabsEvent, bytes: number): ConversationRecord {
    // The body has passed Event Gateway's signature check but its shape is the sender's: check what is read below
    if (!is_record(event?.data)) throw new InvalidEventError('data must be an object');
    const id = event.data.conversation_id;
    if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) throw new InvalidEventError('data.conversation_id must be a string');
    if (event.type === 'post_call_audio' && typeof event.data.full_audio !== 'string') throw new InvalidEventError('data.full_audio must be a base64 string');

    const now = new Date().toISOString();
    const record: ConversationRecord = this.conversations.get(id) || {
      conversation_id: id,
      agent_id: text(event.data.agent_id) ?? '',
      transcript: [],
      data_collection_results: {},
      evaluation_criteria_results: {},
      payload_bytes: {},
      first_received_at: now,
      updated_at: now,
    };

    record.payload_bytes[event.type] = bytes;
    record.updated_at = now;

    if (event.type === 'post_call_transcription') {
      const { data } = event;
      const analysis = is_record(data.analysis) ? data.analysis : {};
      const metadata = is_record(data.metadata) ? data.metadata : {};
      record.agent_id = text(data.agent_id) ?? record.agent_id;
      record.agent_name = text(data.agent_name);
      record.status = text(data.status);
      record.transcript = Array.isArray(data.transcript) ? data.transcript.filter(is_record) : [];
      record.summary = text(analysis.transcript_summary);
      record.outcome = text(analysis.call_successful);
      record.data_collection_results = is_record(analysis.data_collection_results) ? analysis.data_collection_results : {};
      record.evaluation_criteria_results = is_record(analysis.evaluation_criteria_results) ? analysis.evaluation_criteria_results : {};
      record.call_duration_secs = finite(metadata.call_duration_secs);
      record.start_time_unix_secs = finite(metadata.start_time_unix_secs);
      record.termination_reason = text(metadata.termination_reason);
    } else if (event.type === 'post_call_audio') {
      const audio = Buffer.from(event.data.full_audio, 'base64');
      fs.writeFileSync(this.audioPath(id), audio);
      record.audio_file = path.basename(this.audioPath(id));
      record.audio_bytes = audio.length;
    } else if (event.type === 'call_initiation_failure') {
      record.outcome = 'failed_to_start';
      record.failure_reason = text(event.data.failure_reason);
    }

    this.conversations.set(id, record);
    this.processed.add(Store.key(event));
    this.prune();
    this.save();
    return record;
  }

  /** Keeps the newest MAX_CONVERSATIONS, deleting the older ones' audio and idempotency keys */
  private prune() {
    if (this.conversations.size <= MAX_CONVERSATIONS) return;
    for (const old of this.listConversations().slice(MAX_CONVERSATIONS)) {
      this.conversations.delete(old.conversation_id);
      fs.rmSync(this.audioPath(old.conversation_id), { force: true });
      for (const type of ['post_call_transcription', 'post_call_audio', 'call_initiation_failure']) this.processed.delete(`${type}:${old.conversation_id}`);
    }
  }

  reset() {
    this.conversations.clear();
    this.deliveries = [];
    this.processed.clear();
    fs.rmSync(path.join(this.dataDir, 'audio'), { recursive: true, force: true });
    fs.mkdirSync(path.join(this.dataDir, 'audio'), { recursive: true });
    this.save();
  }
}
