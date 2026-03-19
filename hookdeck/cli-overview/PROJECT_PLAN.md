# CLI Overview Presentation - Project Plan

## Project Overview

### Goal
Create an automated, interactive demonstration of Hookdeck CLI guest mode showcasing the complete developer workflow for receiving and managing webhooks locally.

### Key Features Demonstrated
- **Guest Mode**: No authentication required to get started
- **Local Development**: Connect webhook events to local server
- **Event Inspection**: Interactive TUI for viewing event details
- **Event Replay**: Retry/replay events for testing
- **Session Filters**: Focus on specific event types
- **Error Recovery**: Handle and retry failed deliveries

### Target Duration
Approximately 3 minutes (3.5 minutes with optional error recovery scene)

### Based On
- **Framework**: tmux-presenter (reference `../../_shared/tmux-presenter/`)
- **Project Structure**: session-filters project (reference `../session-filters/`)
- **Content**: `cli-overview/walkthrough.md` (existing walkthrough content)

---

## Project Structure

### Directory Layout
```
cli-overview/
├── package.json                 # Project dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── .gitignore                  # Git ignore patterns
├── presentation.yaml           # Main presentation configuration
├── README.md                   # Project documentation
├── walkthrough.md              # Source content (already exists)
└── src/
    └── server.ts               # Local webhook receiver
```

### File Specifications

#### `package.json`
```json
{
  "name": "cli-overview-presentation",
  "version": "1.0.0",
  "description": "Automated presentation demonstrating Hookdeck CLI guest mode",
  "scripts": {
    "server": "ts-node src/server.ts",
    "walkthrough": "tmux-presenter presentation.yaml"
  },
  "dependencies": {
    "express": "^4.18.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0"
  },
  "devDependencies": {
    "tmux-presenter": "file:../../_shared/tmux-presenter",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0"
  }
}
```

#### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

#### `.gitignore`
```
node_modules/
dist/
*.log
.env
.DS_Store
```

---

## Presentation Flow

### Layout Configuration
**3-Pane Layout**:
- **Pane 1 (sender)**: Left vertical split - Execute curl commands
- **Pane 2 (cli)**: Right-top horizontal split - Hookdeck CLI (TUI)
- **Pane 3 (server)**: Right-bottom horizontal split - Local Express server

### Scene Breakdown

#### Scene 1: Title/Introduction
**Duration**: 5 seconds  
**Purpose**: Set context for the demonstration

**Actions**:
- Display title screen with text overlay
- No commands executed

**Speaker Notes**:
> "Welcome to Hookdeck CLI. This demonstration shows how to receive webhooks locally in guest mode - no signup required."

---

#### Scene 2: Start Local Server
**Duration**: 10 seconds  
**Purpose**: Initialize the local webhook receiver

**Actions**:
- **Pane 3 (server)**: Execute `npm run server`
- Wait for server startup message
- Observe: "Server listening on port 3000"

**Speaker Notes**:
> "First, we start our local Express server on port 3000 to receive webhooks."

**Expected Output**:
```
Server listening on http://localhost:3000
Ready to receive webhooks...
```

---

#### Scene 3: Start Hookdeck Listen (Guest Mode)
**Duration**: 15 seconds  
**Purpose**: Launch Hookdeck CLI and capture the webhook URL

**Actions**:
- **Pane 2 (cli)**: Execute `hookdeck listen 3000 shopify`
- **CRITICAL**: Capture Source URL from output
  - Pattern: `https://hkdk.events/[a-z0-9]+`
  - Store as: `HOOKDECK_URL` environment variable
- Wait for TUI to display "Waiting for events..."

**Speaker Notes**:
> "Next, we run hookdeck listen in guest mode. No authentication needed. It instantly gives us a public webhook URL connected to our local port 3000."

**Expected Output**:
```
🎉 Guest mode enabled

Source URL: https://hkdk.events/xxxxxxxxxxxx

Forwarding to: http://localhost:3000
Connection name: shopify

[Interactive TUI appears showing "Waiting for events..."]
```

**Technical Requirement**: Dynamic URL extraction mechanism needed

---

#### Scene 4: Send Shopify Events
**Duration**: 30 seconds  
**Purpose**: Send test webhook events and observe routing

**Actions** (Pane 1 - sender):

**Note**: `${HOOKDECK_URL}` is a placeholder in the YAML configuration. The tmux-presenter must substitute this with the actual captured URL (e.g., `https://hkdk.events/abc123xyz`) before executing the command, so the actual URL is visible in the pane.

1. **Send Order Created Event**:
```bash
curl -X POST https://hkdk.events/abc123xyz \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: orders/create" \
  -d '{
    "id": 1001,
    "email": "alice@example.com",
    "total_price": "29.99"
  }'
```
- Pause: 2 seconds

2. **Send Product Update Event**:
```bash
curl -X POST https://hkdk.events/abc123xyz \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: products/update" \
  -d '{
    "id": 2002,
    "title": "T-shirt",
    "variants": [{"id": 1, "price": "19.99"}]
  }'
```
- Pause: 2 seconds

3. **Send Inventory Update Event**:
```bash
curl -X POST https://hkdk.events/abc123xyz \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: inventory_levels/update" \
  -d '{
    "inventory_item_id": 3003,
    "available": 42
  }'
```

**Observer**:
- **Pane 2 (cli)**: Events appear in TUI list with event type and timestamp
- **Pane 3 (server)**: Server logs each received event

**Speaker Notes**:
> "We send three different Shopify webhook events: an order creation, a product update, and an inventory change. Watch how they appear in the CLI and get forwarded to our local server."

---

#### Scene 5: Navigate Events in TUI (AUTOMATED)
**Duration**: 15 seconds  
**Purpose**: Demonstrate event list navigation

**Actions** (Pane 2 - cli, keyboard automation):
1. Send key: `Down` arrow
   - Pause: 500ms
2. Send key: `Down` arrow
   - Pause: 500ms
3. Send key: `Up` arrow
   - Pause: 500ms
4. Send key: `Down` arrow
   - Pause: 500ms

**Observer**:
- Highlight moves between events in the list
- Selected event changes background color

**Speaker Notes**:
> "Use arrow keys to navigate between events. The highlighted event shows key information at a glance."

**Technical Requirement**: Keyboard event sending capability

---

#### Scene 6: Inspect Event Details (AUTOMATED)
**Duration**: 20 seconds  
**Purpose**: Show detailed event inspection capabilities

**Actions** (Pane 2 - cli, keyboard automation):
1. Send key: `d` (opens detail view)
   - Pause: 3 seconds
2. Send key: `Down` arrow (scroll headers)
   - Pause: 500ms
3. Send key: `Down` arrow (scroll body)
   - Pause: 500ms
4. Send key: `Down` arrow (continue scrolling)
   - Pause: 500ms
5. Send key: `ESC` (return to list)
   - Pause: 1 second

**Observer**:
- Detail view displays full event with:
  - HTTP headers (including X-Shopify-Topic)
  - Request body (formatted JSON)
  - Metadata (timestamp, source, destination)

**Speaker Notes**:
> "Press 'd' to view full event details including all headers and the complete request body. This is perfect for debugging webhook payloads."

**Technical Requirement**: Keyboard event sending capability

---

#### Scene 7: Retry an Event (AUTOMATED)
**Duration**: 15 seconds  
**Purpose**: Demonstrate event replay functionality

**Actions** (Pane 2 - cli, keyboard automation):
1. Send key: `Up` arrow (ensure event is selected)
   - Pause: 500ms
2. Send key: `r` (retry/replay event)
   - Pause: 3 seconds

**Observer**:
- **Pane 2 (cli)**: Event shows "Retrying..." status then "Delivered"
- **Pane 3 (server)**: New log entry for the replayed event

**Speaker Notes**:
> "Press 'r' to replay an event. This is incredibly useful for testing your webhook handler without needing to trigger a new event from the source."

**Technical Requirement**: Keyboard event sending capability

---

#### Scene 8: Apply Session Filter
**Duration**: 30 seconds  
**Purpose**: Demonstrate filtering specific event types

**Actions**:

1. **Stop current session** (Pane 2 - cli):
   - Send signal: `Ctrl+C`
   - Pause: 1 second

2. **Restart with filter** (Pane 2 - cli):
```bash
hookdeck listen 3000 shopify --filter-headers '{"X-Shopify-Topic": "orders/create"}'
```
   - **CRITICAL**: Capture new Source URL and update `HOOKDECK_URL`
   - Wait for TUI to appear

3. **Resend all three events** (Pane 1 - sender):
   - Execute same three curl commands from Scene 4
   - URL is automatically substituted with the newly captured URL
   - 2-second pause between each

**Observer**:
- **Pane 2 (cli)**: Only the `orders/create` event appears
- **Pane 3 (server)**: Only one event logged (orders/create)
- Products/update and inventory_levels/update are filtered out

**Speaker Notes**:
> "Session filters let you focus on specific event types. We've filtered to only receive order creation events. When we replay all three webhooks, only the order event gets through."

**Technical Requirement**: Dynamic URL re-capture after restart

---

#### Scene 9: Error Recovery Demo (OPTIONAL - RECOMMENDED)
**Duration**: 20 seconds  
**Purpose**: Demonstrate resilience and retry capabilities

**Rationale**:
- **Real-world value**: Shows what happens when local dev server crashes
- **Error visibility**: Demonstrates how Hookdeck surfaces delivery failures
- **Recovery**: Shows easy retry mechanism once service is restored
- **Developer experience**: Highlights that events aren't lost during downtime

**Actions**:

1. **Stop local server** (Pane 3 - server):
   - Send signal: `Ctrl+C`
   - Pause: 1 second

2. **Send event while server is down** (Pane 1 - sender):
```bash
curl -X POST https://hkdk.events/abc123xyz \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: products/update" \
  -d '{
    "id": 3003,
    "title": "Updated Product",
    "status": "active"
  }'
```
   - Pause: 2 seconds

3. **Observer** (Pane 2 - cli):
   - Event appears with error status (red icon/text)
   - Error message: "Connection refused" or similar

4. **Restart server** (Pane 3 - server):
   - Execute: `npm run server`
   - Wait for startup message
   - Pause: 2 seconds

5. **Retry failed event** (Pane 2 - cli, keyboard automation):
   - Send key: `Down` arrow (navigate to failed event if needed)
   - Pause: 500ms
   - Send key: `r` (retry)
   - Pause: 2 seconds

6. **Observer**:
   - **Pane 2 (cli)**: Event status changes to "Delivered" (green)
   - **Pane 3 (server)**: Log entry appears for successful delivery

**Speaker Notes**:
> "Even when your local server is down, Hookdeck queues events. You can see failed deliveries in the TUI, and once your server is back up, simply press 'r' to retry. No events lost, no data missed."

**Benefits**:
- Demonstrates fault tolerance
- Shows debugging workflow
- Highlights retry simplicity
- Adds real-world credibility

---

#### Scene 10: Wrap-up
**Duration**: 10 seconds  
**Purpose**: Close the session and provide next steps

**Actions**:
1. **Quit CLI session** (Pane 2 - cli, keyboard automation):
   - Send key: `q`
   - Pause: 1 second

2. **Display closing text overlay**:
   - Text: "Hookdeck CLI - Guest Mode"
   - Subtext: "hookdeck.com/cli"

**Speaker Notes**:
> "That's Hookdeck CLI in guest mode. No setup, no tunnels, no expiration. When you're ready, login to persist connections and share events with your team. Learn more at hookdeck.com/cli."

---

## Technical Implementation Details

### Server Implementation (`src/server.ts`)

**Purpose**: Simple Express server that receives and logs webhook events

**Requirements**:
- Listen on port 3000
- Accept POST requests at root endpoint (`/`)
- Log event details with timestamp
- Display Shopify topic header
- Show payload size

**Implementation**:
```typescript
import express from 'express';

const app = express();
const PORT = 3000;

app.use(express.json());

app.post('/', (req, res) => {
  const timestamp = new Date().toLocaleTimeString('en-US', { 
    hour12: false 
  });
  
  const topic = req.headers['x-shopify-topic'] || 'unknown';
  const bodySize = JSON.stringify(req.body).length;
  
  console.log(
    `[${timestamp}] <- Received Shopify event: ${topic} (${bodySize} bytes)`
  );
  console.log(`   Payload:`, JSON.stringify(req.body, null, 2));
  
  res.status(200).json({ received: true });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log('Ready to receive webhooks...');
});
```

**Log Format Example**:
```
[14:23:15] <- Received Shopify event: orders/create (87 bytes)
   Payload: {
     "id": 1001,
     "email": "alice@example.com",
     "total_price": "29.99"
   }
```

---

### Presentation Configuration (`presentation.yaml`)

#### Layout Structure
```yaml
metadata:
  name: "Hookdeck CLI - Guest Mode Overview"
  description: "Automated demonstration of CLI guest mode features"
  duration: "3-3.5 minutes"

layout:
  panes:
    - name: sender
      position: left
      size: 40%
      
    - name: cli
      position: right-top
      size: 60%
      
    - name: server
      position: right-bottom
      size: 60%
```

#### Dynamic URL Capture (CRITICAL FEATURE)

**Problem**: The Hookdeck Source URL is dynamically generated and must be extracted for use in curl commands.

**Required Capability**:
- Parse pane output after command execution
- Extract text matching regex pattern
- Substitute the captured URL directly into subsequent command strings
- Commands should display the actual URL, not a variable reference

**Proposed YAML Syntax**:
```yaml
scenes:
  - name: "Start Hookdeck Listen"
    steps:
      - type: execute
        pane: cli
        command: "hookdeck listen 3000 shopify"
        wait: 3000
      
      # CAPTURE ACTION - NEW FEATURE NEEDED
      - type: capture
        pane: cli
        pattern: "https://hkdk\\.events/[a-z0-9]+"
        variable: HOOKDECK_URL
        timeout: 5000
        
      - type: wait
        duration: 2000
```

**Usage in Later Commands**:
```yaml
- type: execute
  pane: sender
  command: |
    curl -X POST ${HOOKDECK_URL} \
      -H "Content-Type: application/json" \
      -H "X-Shopify-Topic: orders/create" \
      -d '{"id":1001,"email":"alice@example.com","total_price":"29.99"}'
```

**Critical Requirement**: The actual captured URL must be visible in the executed curl commands (variable substitution).

---

#### Keyboard Event Sending (CRITICAL FEATURE)

**Problem**: Scenes 5-7 require automated keyboard interaction with the TUI.

**Required Capability**:
- Send individual key presses to specific panes
- Support special keys (arrows, ESC, Ctrl+C)
- Support character keys (d, r, q)
- Configurable pause timing

**Proposed YAML Syntax**:
```yaml
- name: "Navigate Events"
  steps:
    # Navigation
    - type: keypress
      pane: cli
      key: "Down"
      pause: 500
    
    - type: keypress
      pane: cli
      key: "Down"
      pause: 500
    
    - type: keypress
      pane: cli
      key: "Up"
      pause: 500
    
    # Open detail view
    - type: keypress
      pane: cli
      key: "d"
      pause: 3000
    
    # Scroll detail view
    - type: keypress
      pane: cli
      key: "Down"
      pause: 500
      repeat: 3
    
    # Close detail view
    - type: keypress
      pane: cli
      key: "ESC"
      pause: 1000
    
    # Retry event
    - type: keypress
      pane: cli
      key: "r"
      pause: 2000
```

**Supported Keys**:
- **Special keys**: `Up`, `Down`, `Left`, `Right`, `ESC`, `Enter`, `Tab`
- **Character keys**: Any single character (`d`, `r`, `q`, etc.)
- **Control keys**: `Ctrl+C`, `Ctrl+D`, etc.

---

#### Signal Sending
For stopping processes (e.g., Ctrl+C):

```yaml
- type: signal
  pane: cli
  signal: SIGINT  # Equivalent to Ctrl+C
  pause: 1000
```

---

#### Complete Scene Example
```yaml
scenes:
  - name: "Inspect Event Details"
    duration: 20
    speaker_notes: |
      Press 'd' to view full event details including all headers 
      and the complete request body. Perfect for debugging.
    
    steps:
      # Open detail view
      - type: keypress
        pane: cli
        key: "d"
        pause: 3000
      
      # Scroll through details
      - type: keypress
        pane: cli
        key: "Down"
        pause: 500
      
      - type: keypress
        pane: cli
        key: "Down"
        pause: 500
      
      - type: keypress
        pane: cli
        key: "Down"
        pause: 500
      
      # Return to list
      - type: keypress
        pane: cli
        key: "ESC"
        pause: 1000
```

---

### README Documentation (`README.md`)

**Required Sections**:

1. **Project Overview**
   - Purpose and goals
   - What's demonstrated

2. **Prerequisites**
   - Node.js 18+
   - tmux installed
   - Hookdeck CLI installed
   - curl (standard on macOS/Linux)

3. **Installation**
```bash
cd cli-overview
npm install
```

4. **Usage**
```bash
# Run automated presentation
npm run walkthrough

# Or run server manually
npm run server
```

5. **Manual Walkthrough**
   - Step-by-step instructions from walkthrough.md
   - For manual demonstration without automation

6. **Project Structure**
   - File descriptions
   - Dependencies explanation

7. **Customization**
   - Modifying presentation.yaml
   - Adjusting timing
   - Changing scenes

---

## Key Differences from session-filters

### Content Differences
| Aspect | session-filters | cli-overview |
|--------|----------------|--------------|
| **Event Source** | GitHub | Shopify |
| **Authentication** | Requires .env file | Guest mode (no auth) |
| **Filter Header** | `x-github-event` | `X-Shopify-Topic` |
| **Event Count** | 8 events | 3 events |
| **Event Sender** | Node.js script | Direct curl commands |
| **URL Format** | `events.hookdeck.com/e/src_xxx` | `hkdk.events/xxx` |
| **Payload Complexity** | Complex GitHub structure | Simple Shopify objects |

### Technical Differences
| Feature | session-filters | cli-overview |
|---------|----------------|--------------|
| **URL Capture** | Not needed (predefined) | **CRITICAL** - Dynamic extraction |
| **Keyboard Automation** | Not used | **CRITICAL** - Navigate TUI |
| **Error Recovery** | Not demonstrated | **RECOMMENDED** - Scene 9 |
| **Sender Implementation** | Separate TypeScript file | Inline curl commands |
| **Dependencies** | Includes Octokit | Simpler (just Express) |

---

## Dependencies and Prerequisites

### System Requirements
- **Operating System**: macOS or Linux
- **Node.js**: Version 18.0 or higher
- **tmux**: Version 3.0 or higher
- **Hookdeck CLI**: Latest version (guest mode support)
- **curl**: Pre-installed on macOS/Linux

### NPM Packages
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0"
  },
  "devDependencies": {
    "tmux-presenter": "file:../../_shared/tmux-presenter",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0"
  }
}
```

### Installation Commands
```bash
# Install Hookdeck CLI (if not already installed)
brew install hookdeck/hookdeck/hookdeck

# Or using npm
npm install -g @hookdeck/cli

# Install tmux (if not already installed)
brew install tmux  # macOS
# or
sudo apt-get install tmux  # Linux
```

---

## Implementation Phases

### Phase 1: Project Setup
**Objective**: Initialize project structure and configuration

**Tasks**:
- [ ] Create `package.json` with dependencies
- [ ] Create `tsconfig.json` for TypeScript
- [ ] Create `.gitignore` file
- [ ] Run `npm install`

**Deliverable**: Functional Node.js/TypeScript project

**Time Estimate**: 15 minutes

---

### Phase 2: Source Files
**Objective**: Implement server and utilities

**Tasks**:
- [ ] Create `src/` directory
- [ ] Implement `src/server.ts` (webhook receiver)
- [ ] Test server manually: `npm run server`
- [ ] Verify logging format

**Deliverable**: Working Express server on port 3000

**Time Estimate**: 30 minutes

**Testing**:
```bash
# Terminal 1
npm run server

# Terminal 2
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: orders/create" \
  -d '{"id":1001,"test":true}'
```

---

### Phase 3: Presentation Configuration
**Objective**: Create automated presentation script

**Tasks**:
- [ ] Create `presentation.yaml`
- [ ] Define 3-pane layout
- [ ] Implement all 10 scenes
- [ ] Add speaker notes
- [ ] Configure timing/pauses

**Sub-tasks**:
- [ ] Scene 1: Title screen
- [ ] Scene 2: Server startup
- [ ] Scene 3: Hookdeck listen + URL capture
- [ ] Scene 4: Send 3 events with curl
- [ ] Scene 5: Navigate events (keyboard automation)
- [ ] Scene 6: Inspect details (keyboard automation)
- [ ] Scene 7: Retry event (keyboard automation)
- [ ] Scene 8: Filter + resend events
- [ ] Scene 9: Error recovery (optional)
- [ ] Scene 10: Wrap-up

**Critical Dependencies**:
- tmux-presenter support for `capture` action
- tmux-presenter support for `keypress` action

**Deliverable**: Complete presentation.yaml file

**Time Estimate**: 2-3 hours

---

### Phase 4: Documentation
**Objective**: Create user-friendly documentation

**Tasks**:
- [ ] Create `README.md`
- [ ] Document installation steps
- [ ] Document usage instructions
- [ ] Add troubleshooting section
- [ ] Include manual walkthrough reference

**Deliverable**: Comprehensive README

**Time Estimate**: 45 minutes

---

### Phase 5: Testing and Refinement
**Objective**: Test and optimize presentation flow

**Tasks**:
- [ ] Test URL capture mechanism
- [ ] Test keyboard automation timing
- [ ] Verify all curl commands work
- [ ] Test error recovery scene (if included)
- [ ] Adjust pause durations
- [ ] Test complete end-to-end flow
- [ ] Verify tmux layout rendering
- [ ] Test on clean environment

**Deliverable**: Production-ready presentation

**Time Estimate**: 1-2 hours

**Testing Checklist**:
- [ ] Server starts and logs correctly
- [ ] Hookdeck CLI launches in guest mode
- [ ] URL is captured and substituted in curl commands
- [ ] All 3 events are sent successfully
- [ ] Keyboard navigation works smoothly
- [ ] Detail view opens and scrolls
- [ ] Retry functionality works
- [ ] Filter correctly blocks events
- [ ] Error recovery demonstrates resilience
- [ ] Total timing is within 3-3.5 minutes

---

## tmux-presenter Feature Requirements

### Feature 1: Dynamic Output Capture ⚠️ CRITICAL

**Status**: 🔴 **REQUIRED** - Not currently implemented

**Description**: Ability to capture text output from a pane, parse it with regex, and store as an environment variable.

**Use Case**: After running `hookdeck listen 3000 shopify`, the CLI outputs a dynamically generated URL like `https://hkdk.events/abc123xyz`. This URL must be extracted and used in subsequent curl commands.

**Proposed Implementation**:

```yaml
- type: capture
  pane: cli
  pattern: "https://hkdk\\.events/[a-z0-9]+"
  variable: HOOKDECK_URL
  timeout: 5000        # Wait up to 5 seconds for pattern to appear
  required: true       # Fail if pattern not found
```

**Technical Approach**:
1. Execute command in specified pane
2. Read pane content using `tmux capture-pane -p`
3. Apply regex pattern to extract match
4. Store in environment variable for session
5. Substitute variable in subsequent commands

**Alternative Workarounds** (if not implemented):
- **Option A**: Manual presenter action - pause and prompt user to copy URL
- **Option B**: Helper script that wraps `hookdeck listen` and exports URL
- **Option C**: Use predefined test URL (loses authenticity)

**Recommendation**: Implement in tmux-presenter - high reusability for other presentations

---

### Feature 2: Keyboard Event Sending ⚠️ CRITICAL

**Status**: 🔴 **REQUIRED** - Not currently implemented

**Description**: Send individual keyboard events to specific panes to automate TUI interaction.

**Use Case**: Automate navigation through Hookdeck CLI TUI:
- Arrow keys to navigate event list
- 'd' key to open event details
- 'r' key to retry events
- ESC to close detail view

**Proposed Implementation**:

```yaml
- type: keypress
  pane: cli
  key: "Down"          # Or: "Up", "d", "r", "ESC", "Enter"
  pause: 500           # Milliseconds to wait after keypress
  repeat: 3            # Optional: repeat key 3 times
```

**Supported Key Types**:

1. **Character Keys**: `a-z`, `0-9`, special chars
2. **Arrow Keys**: `Up`, `Down`, `Left`, `Right`
3. **Special Keys**: `ESC`, `Enter`, `Tab`, `Space`
4. **Function Keys**: `F1`-`F12`

**Technical Approach**:
```bash
# Send arrow key
tmux send-keys -t [pane] Down

# Send character
tmux send-keys -t [pane] "d"

# Send ESC
tmux send-keys -t [pane] Escape
```

**Alternative Workarounds** (if not implemented):
- **Option A**: Manual presenter action - prompt user to press keys
- **Option B**: Pre-record tmux session with `script` command
- **Option C**: Use `expect` script for automation (complex)

**Recommendation**: Implement in tmux-presenter - essential for interactive demos

---

### Feature 3: Signal Sending

**Status**: 🟡 **RECOMMENDED** - May already exist

**Description**: Send OS signals to processes in panes (e.g., Ctrl+C to stop).

**Use Case**: Stop Hookdeck CLI in Scene 8, stop server in Scene 9

**Proposed Implementation**:

```yaml
- type: signal
  pane: cli
  signal: SIGINT       # Ctrl+C
  pause: 1000
```

**Technical Approach**:
```bash
tmux send-keys -t [pane] C-c
```

**Alternative**: May already be implemented as `send-keys` with `C-c`

---

### Feature 4: Wait Conditions (OPTIONAL)

**Status**: 🟢 **NICE TO HAVE** - Improves reliability

**Description**: Wait for specific text to appear in pane before proceeding.

**Use Case**: Wait for "Server listening..." before sending events

**Proposed Implementation**:

```yaml
- type: wait_for
  pane: server
  pattern: "Server listening"
  timeout: 10000
  on_timeout: fail     # or: continue, skip_scene
```

**Alternative**: Use fixed `wait` durations (less reliable but simpler)

---

## Open Questions for Review

### Question 1: Include Scene 9 (Error Recovery)?

**Recommendation**: ✅ **YES - Include Scene 9**

**Rationale**:
- **Real-world credibility**: Demonstrates actual development scenario
- **Key differentiator**: Shows Hookdeck's resilience vs simple tunneling
- **Educational value**: Teaches error handling workflow
- **Minimal time cost**: Only adds 20 seconds to total duration
- **High impact**: Memorable "aha moment" for viewers

**Tradeoff**: Slightly longer presentation (3m 30s vs 3m 10s)

**Alternative**: Create two versions of presentation.yaml:
- `presentation.yaml` - Full version with Scene 9
- `presentation-short.yaml` - Without Scene 9

---

### Question 2: tmux-presenter Feature Implementation

**Critical Features Needed**:
1. ⚠️ **Dynamic URL Capture** - REQUIRED
2. ⚠️ **Keyboard Event Sending** - REQUIRED
3. 🟡 **Signal Sending** - May exist, need to verify

**Options**:

**Option A**: Enhance tmux-presenter (RECOMMENDED)
- **Pros**: 
  - Reusable for other presentations
  - Clean YAML syntax
  - Maintainable solution
- **Cons**: 
  - Development time required
  - Testing needed
- **Time**: 4-6 hours development + testing

**Option B**: Manual presenter actions
- **Pros**: 
  - No development needed
  - Works immediately
- **Cons**: 
  - Not automated (defeats purpose)
  - Inconsistent timing
  - Human error prone
- **Time**: Minimal

**Option C**: Hybrid approach
- **Pros**: 
  - Start testing immediately
  - Incrementally automate
- **Cons**: 
  - Temporary workarounds needed
  - May need refactoring
- **Time**: Variable

**Recommendation**: 
1. Start with **Option B** for initial testing (validate presentation flow)
2. Implement **Option A** for production (proper automation)
3. Prioritize URL capture first (Scene 3), then keyboard events (Scenes 5-7)

---

### Question 3: Keyboard Automation Timing

**Current Estimates**:
- Navigation keypresses: 500ms pause
- Detail view open: 3000ms pause
- Scrolling: 500ms between presses
- Retry action: 2000ms pause

**Question**: Are these timings realistic for visual comprehension?

**Testing Approach**:
1. Record manual walkthrough with screen capture
2. Measure comfortable interaction speed
3. Add 20-30% buffer for visual clarity
4. Adjust based on playback review

**Factors to Consider**:
- TUI render speed
- Screen recording frame rate
- Viewer comprehension time
- Need for post-production editing (may add visual indicators)

---

### Question 4: URL Format Confirmation

**Assumption**: Guest mode uses `https://hkdk.events/[a-z0-9]+`

**Need to Verify**:
- Exact URL pattern (letters? numbers? both?)
- Character length (appears to be 12 characters in examples)
- Are URLs session-persistent or change on restart?

**Testing**:
```bash
hookdeck listen 3000 test --guest
# Capture actual URL output
```

**Impact**: Affects regex pattern in capture action

---

### Question 5: Presentation Distribution

**Formats**:
- **Source code**: GitHub repository
- **Video recording**: Screen capture with voiceover
- **Live demo**: Conference/webinar presentation

**Questions**:
- Should presentation.yaml be parameterized for customization?
- Include pre-recorded backup video?
- Create presentation slide deck to accompany?

**Recommendation**: 
- Primary: Automated tmux-presenter execution
- Secondary: Screen recording for distribution
- Tertiary: Slide deck with key points

---

## Success Criteria

### Functional Requirements
- [ ] Presentation runs automatically from start to finish
- [ ] All 10 scenes execute without errors
- [ ] URL capture works reliably
- [ ] Keyboard automation navigates TUI correctly
- [ ] Events are sent and received successfully
- [ ] Server logs display properly
- [ ] Total duration is 3-3.5 minutes

### Quality Requirements
- [ ] Timing feels natural (not rushed or too slow)
- [ ] Visual layout is clear and readable
- [ ] Speaker notes align with on-screen actions
- [ ] Error recovery (Scene 9) demonstrates value clearly
- [ ] No manual intervention required during playback

### Documentation Requirements
- [ ] README provides clear installation steps
- [ ] Prerequisites are explicitly listed
- [ ] Usage instructions are straightforward
- [ ] Troubleshooting section addresses common issues
- [ ] Manual walkthrough is available as fallback

---

## Next Steps

### Immediate Actions
1. **Review this plan**: Stakeholder approval on scope and approach
2. **Decision on Scene 9**: Confirm inclusion of error recovery scene
3. **tmux-presenter features**: Decide on implementation approach (manual vs automated)
4. **Begin Phase 1**: Project setup and dependency installation

### Parallel Workstreams
**Workstream A - Presentation Content** (Can start immediately):
- Phase 1: Project setup
- Phase 2: Server implementation
- Phase 4: Documentation

**Workstream B - tmux-presenter Enhancement** (If pursuing Option A):
- Implement `capture` action
- Implement `keypress` action
- Test and document

**Workstream C - Integration** (After A & B):
- Phase 3: Create presentation.yaml
- Phase 5: Testing and refinement

### Timeline Estimate
- **If tmux-presenter features exist**: 1 day implementation + testing
- **If manual approach**: 4-6 hours implementation + practice
- **If implementing features**: 2-3 days development + testing + integration

---

## Appendix

### Appendix A: Complete Scene Summary

| Scene | Name | Duration | Automation | Critical Features |
|-------|------|----------|------------|-------------------|
| 1 | Title/Intro | 5s | Text overlay | None |
| 2 | Start Server | 10s | Command execution | None |
| 3 | Hookdeck Listen | 15s | Command + capture | ⚠️ URL Capture |
| 4 | Send Events | 30s | Curl commands | Variable substitution |
| 5 | Navigate TUI | 15s | Keyboard automation | ⚠️ Keypress |
| 6 | Inspect Details | 20s | Keyboard automation | ⚠️ Keypress |
| 7 | Retry Event | 15s | Keyboard automation | ⚠️ Keypress |
| 8 | Apply Filter | 30s | Restart + commands | ⚠️ URL Re-capture |
| 9 | Error Recovery | 20s | Stop/start/retry | ⚠️ Keypress (optional) |
| 10 | Wrap-up | 10s | Keyboard + overlay | None |

**Total**: 170 seconds (2m 50s) to 190 seconds (3m 10s)

---

### Appendix B: Required tmux Commands Reference

```bash
# Create session with layout
tmux new-session -s presentation -d
tmux split-window -h -t presentation
tmux split-window -v -t presentation

# Send commands to panes
tmux send-keys -t presentation:0.0 "npm run server" Enter
tmux send-keys -t presentation:0.1 "hookdeck listen 3000 shopify" Enter

# Capture pane output
tmux capture-pane -t presentation:0.1 -p

# Send special keys
tmux send-keys -t presentation:0.1 Down
tmux send-keys -t presentation:0.1 C-c

# Send characters
tmux send-keys -t presentation:0.1 "d"
tmux send-keys -t presentation:0.1 "r"
```

---

### Appendix C: Testing Checklist

**Pre-flight**:
- [ ] Node.js installed (check: `node --version`)
- [ ] tmux installed (check: `tmux -V`)
- [ ] Hookdeck CLI installed (check: `hookdeck --version`)
- [ ] curl available (check: `curl --version`)

**Component Tests**:
- [ ] Server starts: `npm run server`
- [ ] Server receives webhooks: `curl -X POST http://localhost:3000 ...`
- [ ] Hookdeck CLI guest mode works: `hookdeck listen 3000 test`
- [ ] URL appears in expected format

**Integration Tests**:
- [ ] Full presentation runs: `npm run walkthrough`
- [ ] All scenes execute in order
- [ ] No errors in any pane
- [ ] Timing feels appropriate

**Edge Cases**:
- [ ] What if Hookdeck CLI takes longer to start?
- [ ] What if URL pattern changes?
- [ ] What if server port is in use?
- [ ] What if keyboard events are sent too fast?

---

### Appendix D: Troubleshooting Guide

**Issue**: URL not captured
- **Check**: Pattern matches actual CLI output
- **Fix**: Update regex in presentation.yaml
- **Fallback**: Manual URL entry

**Issue**: Keyboard events not working
- **Check**: TUI is focused and responsive
- **Fix**: Add longer pauses before keypresses
- **Fallback**: Manual keyboard interaction

**Issue**: Events not appearing in TUI
- **Check**: URL is correct and network accessible
- **Fix**: Verify curl commands use ${HOOKDECK_URL}
- **Fallback**: Use `hookdeck test` command

**Issue**: Server not logging events
- **Check**: Server is running and listening
- **Fix**: Restart server, verify port 3000 available
- **Fallback**: Use `nc -l 3000` to verify connectivity

---

**Document Version**: 1.0  
**Last Updated**: 2025-10-23  
**Status**: Draft - Awaiting Review