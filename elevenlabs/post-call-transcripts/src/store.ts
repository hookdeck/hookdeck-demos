import * as fs from 'fs';
import * as path from 'path';
import {
  ConversationRecord,
  DeliveryRecord,
  ElevenLabsEvent,
} from './events';

const MAX_DELIVERIES = 200;

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
    try {
      const saved = JSON.parse(fs.readFileSync(this.file('state.json'), 'utf-8'));
      for (const record of saved.conversations || []) this.conversations.set(record.conversation_id, record);
      this.deliveries = saved.deliveries || [];
      this.processed = new Set(saved.processed || []);
    } catch {
      // First run: nothing saved yet
    }
  }

  private save() {
    const state = {
      conversations: [...this.conversations.values()],
      deliveries: this.deliveries,
      processed: [...this.processed],
    };
    fs.writeFileSync(this.file('state.json'), JSON.stringify(state, null, 2));
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
    return path.join(this.dataDir, 'audio', `${conversation_id.replace(/[^A-Za-z0-9_-]/g, '_')}.mp3`);
  }

  /**
   * Merges an event into the conversation it belongs to. Events for one conversation
   * can arrive in any order (the audio before the transcription, for example), so each
   * type only writes its own fields.
   */
  apply(event: ElevenLabsEvent, bytes: number): ConversationRecord {
    const now = new Date().toISOString();
    const id = event.data.conversation_id;
    const record: ConversationRecord = this.conversations.get(id) || {
      conversation_id: id,
      agent_id: event.data.agent_id,
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
      record.agent_id = data.agent_id;
      record.agent_name = data.agent_name;
      record.status = data.status;
      record.transcript = data.transcript || [];
      record.summary = data.analysis?.transcript_summary;
      record.outcome = data.analysis?.call_successful;
      record.data_collection_results = data.analysis?.data_collection_results || {};
      record.evaluation_criteria_results = data.analysis?.evaluation_criteria_results || {};
      record.call_duration_secs = data.metadata?.call_duration_secs;
      record.start_time_unix_secs = data.metadata?.start_time_unix_secs;
      record.termination_reason = data.metadata?.termination_reason;
    } else if (event.type === 'post_call_audio') {
      const audio = Buffer.from(event.data.full_audio, 'base64');
      fs.writeFileSync(this.audioPath(id), audio);
      record.audio_file = path.basename(this.audioPath(id));
      record.audio_bytes = audio.length;
    } else if (event.type === 'call_initiation_failure') {
      record.outcome = 'failed_to_start';
      record.failure_reason = event.data.failure_reason;
    }

    this.conversations.set(id, record);
    this.processed.add(Store.key(event));
    this.save();
    return record;
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
