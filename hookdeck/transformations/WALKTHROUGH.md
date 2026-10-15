# Video walkthrough: files in, files out

A 60-second script for the binary payloads and Node.js transformations announcement. It uses three demos in this repo:

- [`deepgram/stt-tts`](../../deepgram/stt-tts/): text-to-speech audio delivered as a binary callback
- [`hookdeck/binary-payloads`](../binary-payloads/): 30 content types checked byte-exact on arrival
- [`hookdeck/transformations`](./): JSON events turned into a PNG, WAV and PDF with Node.js built-ins

## Before recording

1. Start all three demos and open each one in its own browser tab:
   - Deepgram: `npm run listen` and `npm start` (http://localhost:4000/tts)
   - Binary payloads: `npm run ui` (http://localhost:4300)
   - Transformations: `npm start` (http://localhost:4400)
2. Zoom the pages to about 150% and switch to light mode.
3. Clear earlier results so every row starts empty.
4. Record system audio. The text-to-speech audio and the chime are the moments people remember.

## Script

The voiceover is about 145 words.

| Time | On screen | Voiceover |
|---|---|---|
| 0–6s | Transformations demo, the receipt-card example, nothing sent yet | "Not every webhook is JSON. Hookdeck's Event Gateway now handles files going in, and files coming out." |
| 6–16s | Deepgram TTS tab: type "Hello from Hookdeck" and submit. The status updates and the audio player appears; click play | "Deepgram's text-to-speech sends the generated audio to your callback as an MP3. It comes through Hookdeck byte for byte, and here it is." *(let the audio play)* |
| 16–24s | Binary payloads tab: click **Send all**, the rows turn green, then expand the zip preview | "Images, audio, video, archives, protobuf: thirty content types, each checked byte-exact on arrival." |
| 24–40s | Transformations tab: send a payment and the PNG card appears. Pick another customer and send again, and the identicon changes. Then select **resolved** on the incident chime, send, and play | "And transformations can now run Node.js. This one takes a payment event and returns a PNG receipt, with an avatar generated from the customer ID. This one turns an incident alert into a sound." *(let the chime play)* |
| 40–50s | Invoice example: send, and the PDF appears. Click **View code**: the modal opens with the `node:zlib` and `node:crypto` imports highlighted | "An order becomes a PDF invoice. No npm packages, no bundling. Only Node's own `zlib` and `crypto`." |
| 50–60s | Cut to the blog post title or this repo's README, then an end card with the post URL and `github.com/hookdeck/hookdeck-demos` | "Files in, files out. The demos and guides are linked in the post." |

## Notes

- **Pacing:** each delivery arrives in under half a second, so there's no need to wait.
- **Audio beats:** let the text-to-speech audio and the chime play for one to two seconds before speaking over them.
- **Social versions:** for LinkedIn and X, export at 1080p with burned-in captions, since many people watch muted.
