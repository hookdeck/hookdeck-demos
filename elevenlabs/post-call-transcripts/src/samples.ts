import { createHmac, randomBytes } from 'crypto';

/**
 * Sample payloads in the shape ElevenLabs documents, and a signer that produces the
 * ElevenLabs-Signature header. Used by the tests and by `npm run send`.
 */

export function conversationId(): string {
  return `conv_${randomBytes(13).toString('hex')}`;
}

export function transcriptionEvent(conversation_id = conversationId(), agent_id = 'agent_demo') {
  const now = Math.floor(Date.now() / 1000);
  return {
    type: 'post_call_transcription',
    event_timestamp: now,
    data: {
      agent_id,
      agent_name: 'Appointment booking agent',
      conversation_id,
      status: 'done',
      user_id: null,
      transcript: [
        { role: 'agent', message: 'Hi, this is the booking line. How can I help?', time_in_call_secs: 0 },
        { role: 'user', message: 'I would like to book a haircut on Friday afternoon.', time_in_call_secs: 4 },
        { role: 'agent', message: 'Friday at 3pm is free. Shall I book it?', time_in_call_secs: 8 },
        { role: 'user', message: 'Yes please. My name is Sam.', time_in_call_secs: 12 },
      ],
      metadata: {
        start_time_unix_secs: now - 30,
        call_duration_secs: 30,
        cost: 296,
        termination_reason: 'end_call tool was called.',
      },
      analysis: {
        call_successful: 'success',
        transcript_summary: 'Sam booked a haircut for Friday at 3pm.',
        evaluation_criteria_results: {
          booking_made: { criteria_id: 'booking_made', result: 'success', rationale: 'A slot was confirmed.' },
        },
        data_collection_results: {
          caller_name: { data_collection_id: 'caller_name', value: 'Sam', rationale: 'The caller gave their name.' },
          requested_service: { data_collection_id: 'requested_service', value: 'haircut' },
          requested_time: { data_collection_id: 'requested_time', value: 'Friday 3 pm' },
        },
      },
      has_audio: true,
    },
  };
}

export function audioEvent(conversation_id: string, agent_id = 'agent_demo', audio = Buffer.from('ID3-sample-audio')) {
  return {
    type: 'post_call_audio',
    event_timestamp: Math.floor(Date.now() / 1000),
    data: { agent_id, conversation_id, full_audio: audio.toString('base64') },
  };
}

export function failureEvent(conversation_id = conversationId(), agent_id = 'agent_demo') {
  return {
    type: 'call_initiation_failure',
    event_timestamp: Math.floor(Date.now() / 1000),
    data: {
      agent_id,
      conversation_id,
      failure_reason: 'no-answer',
      metadata: { type: 'twilio', body: { CallStatus: 'no-answer', To: '+441111111111' } },
    },
  };
}

/** ElevenLabs-Signature: t=<unix seconds>,v0=<hex HMAC-SHA256 of "<t>.<raw body>"> */
export function sign(secret: string, raw_body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${raw_body}`).digest('hex');
  return `t=${timestamp},v0=${digest}`;
}
