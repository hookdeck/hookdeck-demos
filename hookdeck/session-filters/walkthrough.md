# Hookdeck CLI Demo – Interactive Mode & Session Filters

**Runtime:** ~2 minutes  
**Tone:** Developer-to-developer  

---

## Presenter setup summary (off-screen)

1. Run `npm run server` before recording.  
2. Keep server output minimal (one or two lines visible).  
3. Then follow the sequence:  
   - Start `hookdeck listen`  
   - Run `npm run webhooks` (noise)  
   - Restart `hookdeck listen` with session filter  
   - Run `npm run webhooks` again (filtered)  
   - Finish with interactive UI navigation.


---

## Title (5 s)

**On-screen text:**  
Hookdeck CLI – Interactive Mode & Session Filters

**Voiceover:**  
> “When you’re testing webhooks locally, things can get noisy fast.  
> You might see events triggered by your teammates or from other systems, and it’s hard to pick out the ones you actually need.  
> That’s why the Hookdeck CLI now includes two features — interactive mode and session filters — to help you debug faster and stay focused.”

---

## Scene 1 – Setup and show the noise (40 s)

**Voiceover:**  
> “I’ve already got a simple local server running that just logs each webhook it receives.”

*(Optional quick overlay – a single line of server output)*  
```
[13:27:21] Server listening on port 3000
[13:27:21] Webhook URL: http://localhost:3000/webhooks/github
```

**Voiceover:**  
> “Now, let’s run the ` hookdeck listen` command. The new Interactive mode is on by default, so you’ll see a live terminal view of incoming events.”

**Terminal A:**  
```bash
hookdeck listen 3000 github --path /webhooks/github
```

**Voiceover:**  
> “In another terminal, I’ll trigger a burst of GitHub-style webhooks to simulate a noisy shared environment.”

**Terminal B:**  
```bash
npm run webhooks -- --url https://hkdk.events/xrq97abej9tp16 --verbose --loops 2
```

**On-screen fast cut of output:**  
```
[13:29:50] -> POST push (1067 bytes)
[13:29:51] -> POST issues (648 bytes)
[13:29:53] -> POST pull_request (721 bytes)
[13:29:57] -> POST star (310 bytes)
...
```

**Voiceover:**  
> “Here’s the problem — lots of event types hitting your listener all at once.”

---

## Scene 2 – Apply session filters (35 s)

**Voiceover:**  
> “Session filters let you narrow that stream to only the events you care about while this session is active.  
> The filtering happens in the Hookdeck Event Gateway before the events are delivered to you.”

**Terminal A:**  
```bash
hookdeck listen 3000 github --path /webhooks/github   --filter-headers '{"x-github-event": "pull_request"}'
```

**CLI output:**  
```
⚙️ Active session filters:  
  headers = {"x-github-event":"pull_request"}  
Only matching events will be forwarded.
```

**Voiceover:**  
> “Now I’ll trigger the same webhook sequence again.”

**Terminal B:**  
```bash
npm run webhooks -- --url https://hkdk.events/xrq97abej9tp16 --verbose --loops 1
```

**Filtered output:**  
```
<- Received GitHub event: pull_request (721 bytes)
```

**Voiceover:**  
> “This time only pull-request events make it through.  
> Once you stop `listen`, the filters disappear — the filters aren't persisted in the Hookdeck Event Gateway.”

---

## Scene 3 – Explore with interactive mode (30 s)

**Voiceover:**  
> “Interactive mode gives you an easier way to inspect and replay events.  
> You can scroll through them, view the request and response details, retry a delivery, or jump straight to the dashboard.”

**On-screen key hints:**  
`↑ ↓` navigate `d` details `r` retry `o` open in dashboard `q` quit

---

## Scene 4 – Wrap-up (10–15 s)

**Voiceover:**  
> “Session filters keep your local testing focused.  
> Interactive mode gives you clear visibility into every event, and the ability to inspect and replay them directly from your terminal.  
> And you can update to the latest Hookdeck CLI to try them out.”

**Terminal:**  
```bash
brew upgrade hookdeck-cli
# or
npm update -g hookdeck-cli
```

**End screen:**  
hookdeck.com • Reliable webhooks for development and production

---