/**
 * Shapes of the ElevenLabs post-call webhook payloads this demo stores.
 * Reference: https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks
 * Only the fields the demo reads are typed; everything else is kept as received.
 */

export interface TranscriptTurn {
  role: 'agent' | 'user';
  message: string | null;
  time_in_call_secs?: number;
  [key: string]: unknown;
}

export interface DataCollectionResult {
  data_collection_id?: string;
  value?: unknown;
  rationale?: string;
  [key: string]: unknown;
}

export interface EvaluationResult {
  criteria_id?: string;
  result?: 'success' | 'failure' | 'unknown';
  rationale?: string;
  [key: string]: unknown;
}

export interface PostCallTranscriptionData {
  agent_id: string;
  agent_name?: string;
  conversation_id: string;
  status?: string;
  user_id?: string | null;
  transcript?: TranscriptTurn[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    cost?: number;
    termination_reason?: string;
    [key: string]: unknown;
  };
  analysis?: {
    call_successful?: 'success' | 'failure' | 'unknown';
    transcript_summary?: string;
    evaluation_criteria_results?: Record<string, EvaluationResult>;
    data_collection_results?: Record<string, DataCollectionResult>;
    [key: string]: unknown;
  };
  has_audio?: boolean;
  [key: string]: unknown;
}

export interface PostCallAudioData {
  agent_id: string;
  conversation_id: string;
  full_audio: string; // base64 MP3
  [key: string]: unknown;
}

export interface CallInitiationFailureData {
  agent_id: string;
  conversation_id: string;
  failure_reason: 'busy' | 'no-answer' | 'unknown' | string;
  metadata?: { type?: string; body?: Record<string, unknown> };
}

export type ElevenLabsEvent =
  | { type: 'post_call_transcription'; event_timestamp: number; data: PostCallTranscriptionData }
  | { type: 'post_call_audio'; event_timestamp: number; data: PostCallAudioData }
  | { type: 'call_initiation_failure'; event_timestamp: number; data: CallInitiationFailureData };

export const HANDLED_TYPES = ['post_call_transcription', 'post_call_audio', 'call_initiation_failure'] as const;

/** The stored view of a conversation, merged from the events that mention it. */
export interface ConversationRecord {
  conversation_id: string;
  agent_id: string;
  agent_name?: string;
  status?: string;
  /** analysis.call_successful, or "failed_to_start" for call_initiation_failure */
  outcome?: string;
  summary?: string;
  transcript: TranscriptTurn[];
  data_collection_results: Record<string, DataCollectionResult>;
  evaluation_criteria_results: Record<string, EvaluationResult>;
  call_duration_secs?: number;
  start_time_unix_secs?: number;
  termination_reason?: string;
  failure_reason?: string;
  audio_file?: string;
  audio_bytes?: number;
  /** Byte size of each event type's request body as received */
  payload_bytes: Record<string, number>;
  first_received_at: string;
  updated_at: string;
}

/** One webhook request received at /webhooks/elevenlabs, whatever its outcome. */
export interface DeliveryRecord {
  id: string;
  received_at: string;
  type: string;
  conversation_id?: string;
  bytes: number;
  /** stored, duplicate, simulated_failure, invalid_payload, signature_rejected */
  result: string;
  status_code: number;
  hookdeck_event_id?: string;
  hookdeck_attempt?: string;
  signature_header?: string;
}
