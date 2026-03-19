# Sample Presentation Configuration

This is a sample YAML configuration file for the tmux-presenter framework, demonstrating how the current session-filters demo would be configured.

```yaml
# Hookdeck CLI Demo Presentation Configuration
# This file defines the tmux-based presentation for the session-filters demo

metadata:
  name: "Hookdeck CLI Demo – Interactive Mode & Session Filters"
  duration: "2 minutes"
  tone: "Developer-to-developer"
  description: |
    Demonstrates how Hookdeck CLI's interactive mode and session filters
    help developers debug webhooks faster by filtering out noise and 
    providing clear visibility into events.

environment:
  variables:
    - name: HOOKDECK_URL
      required: true
      source: .env
      description: "Your Hookdeck endpoint URL"
  workingDirectory: ./
  checks:
    - command: "which tmux"
      errorMessage: "tmux is not installed. Please install it first."
    - command: "test -f .env"
      errorMessage: "Missing .env file with HOOKDECK_URL"

layout:
  sessionName: hookdeck-demo
  terminal:
    spawn: true
    title: "Hookdeck Demo - Presentation View"
    width: 1200
    height: 600
  controller:
    title: "Hookdeck Demo - Presenter View"
  panes:
    - id: sender
      title: "WEBHOOK SENDER"
      position: 0
      width: 33%
      initialCommand: "clear"
    - id: cli
      title: "HOOKDECK CLI"
      position: 1
      width: 34%
      defaultFocus: true
      initialCommand: "clear"
    - id: server
      title: "SERVER"
      position: 2
      width: 33%
      initialCommand: "clear"

steps:
  # Title Scene
  - id: title
    title: "Title Screen"
    duration: "5s"
    speaker_notes: |
      # Title (5s)
      
      **Key Message:**
      When you're testing webhooks locally, things can get noisy fast.
      You might see events triggered by your teammates or from other systems.
      
      **Introduce two features:**
      - Interactive mode (on by default)
      - Session filters (filter at the gateway level)
      
      Both help you debug faster and stay focused.
    actions:
      - type: prompt
        message: "Hookdeck CLI Demo - Press ENTER to begin..."

  # Scene 1: Setup and show the noise
  - id: scene1_setup
    title: "Scene 1 - Setup Server"
    duration: "40s"
    speaker_notes: |
      # Scene 1 – Setup and show the noise (40s)
      
      **Talking Points:**
      - Simple local server that logs each webhook
      - Server is already set up
      - Focus on the webhook testing workflow
      
      **Expected Output:**
      ```
      [13:27:21] Server listening on port 3000
      [13:27:21] Webhook URL: http://localhost:3000/webhooks/github
      ```
    actions:
      - type: command
        pane: server
        command: "npm run server"
        wait: true
        prompt: "Start the webhook receiver server"
        typeSpeed: 50  # ms between characters
      - type: pause
        duration: 2000

  - id: scene1_listen
    title: "Start Hookdeck Listen"
    speaker_notes: |
      **Talking Points:**
      - hookdeck listen command proxies webhooks to local server
      - Interactive mode is ON by default
      - Live terminal view of incoming events
      
      **Command Explanation:**
      - 3000: local server port
      - github: source name in Hookdeck
      - --path: webhook endpoint path
    actions:
      - type: command
        pane: cli
        command: "hookdeck listen 3000 github --path /webhooks/github"
        wait: true
        prompt: "Start hookdeck listen (no filters)"
        typeSpeed: 30
      - type: pause
        duration: 3000

  - id: scene1_noise
    title: "Trigger Webhook Noise"
    speaker_notes: |
      **Talking Points:**
      - Simulating a noisy shared environment
      - Multiple GitHub event types
      - This is what happens without filtering
      
      **Events being sent:**
      - push events
      - issues events  
      - pull_request events
      - star events
      - watch events
      - fork events
      
      **Problem to highlight:**
      Hard to find the events you care about!
    actions:
      - type: command
        pane: sender
        command: "npm run webhooks -- --url ${HOOKDECK_URL} --verbose --loops 2"
        wait: true
        prompt: "Trigger webhook noise (multiple event types)"
        typeSpeed: 30
      - type: prompt
        message: |
          Scene 1 complete.
          Notice all the different event types flooding in.
          This noise makes debugging difficult!

  # Scene 2: Apply session filters
  - id: scene2_stop_cli
    title: "Scene 2 - Stop CLI"
    duration: "35s"
    speaker_notes: |
      # Scene 2 – Apply session filters (35s)
      
      **Key Points:**
      - Session filters are temporary (only for this session)
      - Filtering happens at Hookdeck's gateway
      - Events are filtered BEFORE delivery
      - No changes to webhook source needed
    actions:
      - type: signal
        pane: cli
        signal: "C-c"
        wait: true
        prompt: "Stop hookdeck listen to apply filters"
      - type: pause
        duration: 1000

  - id: scene2_restart_filtered
    title: "Restart with Session Filter"
    speaker_notes: |
      **Command Breakdown:**
      - Same base command as before
      - Adding --filter-headers flag
      - Filtering for x-github-event: pull_request
      - Only pull_request events will come through
      
      **Expected Output:**
      ```
      ⚙️ Active session filters:
        headers = {"x-github-event":"pull_request"}
      Only matching events will be forwarded.
      ```
    actions:
      - type: command
        pane: cli
        command: |
          hookdeck listen 3000 github --path /webhooks/github \
          --filter-headers '{"x-github-event":"pull_request"}'
        wait: true
        prompt: "Restart with pull_request filter"
        typeSpeed: 30
      - type: pause
        duration: 3000

  - id: scene2_filtered_test
    title: "Test Filtered Webhooks"
    speaker_notes: |
      **What to observe:**
      - Same webhook sequence as before
      - But only pull_request events come through
      - All other events filtered at gateway
      - Much cleaner debugging experience
      
      **Key Benefit:**
      Focus on exactly what you're testing!
    actions:
      - type: command
        pane: sender
        command: "npm run webhooks -- --url ${HOOKDECK_URL} --verbose --loops 1"
        wait: true
        prompt: "Trigger webhooks again (with filter active)"
        typeSpeed: 30
      - type: prompt
        message: |
          Scene 2 complete.
          Only pull_request events were received!
          Session filters keep your testing focused.

  # Scene 3: Interactive Mode
  - id: scene3_interactive
    title: "Scene 3 - Interactive Mode"
    duration: "30s"
    speaker_notes: |
      # Scene 3 – Explore with interactive mode (30s)
      
      **Interactive Mode Features:**
      - Navigate through events with arrow keys
      - View full request/response details
      - Retry failed deliveries instantly
      - Jump to web dashboard for deeper inspection
      
      **Keyboard Shortcuts:**
      - ↑↓ = Navigate events
      - d = View details (request/response)
      - r = Retry delivery
      - o = Open in dashboard
      - q = Quit interactive mode
      
      **Let audience try it:**
      Give them 15-20 seconds to explore
    actions:
      - type: focus
        pane: cli
      - type: prompt
        message: |
          Interactive Mode Controls:
          
            ↑↓ - Navigate events
            d  - View details
            r  - Retry delivery  
            o  - Open in dashboard
            q  - Quit
          
          Try exploring the events now!

  # Scene 4: Wrap-up
  - id: scene4_wrapup
    title: "Scene 4 - Wrap-up"
    duration: "10-15s"
    speaker_notes: |
      # Scene 4 – Wrap-up (10–15s)
      
      **Key Takeaways:**
      1. Session filters = focused local testing
      2. Interactive mode = clear visibility & control
      3. No more webhook noise during development
      
      **Call to Action:**
      Update to latest Hookdeck CLI to try these features
      
      **Installation:**
      - brew upgrade hookdeck-cli
      - npm update -g hookdeck-cli
    actions:
      - type: prompt
        message: |
          Demo Complete! 
          
          Key Features Demonstrated:
          ✓ Interactive mode for clear event visibility
          ✓ Session filters for focused testing
          ✓ Direct inspect and replay from terminal
          
          To clean up:
          - Press Ctrl+C in each pane
          - Or run: tmux kill-session -t hookdeck-demo

  # Cleanup
  - id: cleanup
    title: "Cleanup"
    optional: true
    speaker_notes: |
      Optional cleanup step if needed.
      Can be triggered manually or skipped.
    actions:
      - type: signal
        pane: server
        signal: "C-c"
      - type: signal
        pane: cli
        signal: "C-c"
      - type: command
        pane: sender
        command: "tmux kill-session -t hookdeck-demo"
        executeInBackground: true

# Navigation shortcuts (optional)
navigation:
  shortcuts:
    - key: "n"
      action: "next"
      description: "Next step"
    - key: "p"
      action: "previous"
      description: "Previous step"
    - key: "r"
      action: "restart"
      description: "Restart presentation"
    - key: "g"
      action: "goto"
      description: "Go to specific step"
    - key: "q"
      action: "quit"
      description: "Quit presentation"
  
  autoAdvance:
    enabled: false
    defaultDelay: 1000

# Presentation settings
settings:
  showProgress: true
  showStepNumbers: true
  showDuration: true
  confirmBeforeQuit: true
  logCommands: true
  recordSession: false  # Future feature
```

## Configuration Structure Explained

### 1. Metadata Section
Defines basic information about the presentation including name, duration, and description.

### 2. Environment Section
- **Variables**: Environment variables needed for the presentation
- **Working Directory**: Where commands will be executed
- **Checks**: Pre-flight checks to ensure requirements are met

### 3. Layout Section
- **Session Name**: Tmux session identifier
- **Terminal**: Configuration for spawned terminal window
- **Panes**: Definition of each pane in the layout

### 4. Steps Section
Each step contains:
- **ID**: Unique identifier for the step
- **Title**: Display title for the step
- **Duration**: Expected duration (for timing guidance)
- **Speaker Notes**: Markdown-formatted notes for the presenter
- **Actions**: List of actions to perform

### 5. Action Types

#### Command Action
```yaml
- type: command
  pane: server
  command: "npm run server"
  wait: true
  prompt: "Start the server"
  typeSpeed: 50
```

#### Signal Action (Send keyboard signals)
```yaml
- type: signal
  pane: cli
  signal: "C-c"
  wait: true
  prompt: "Stop the process"
```

#### Pause Action
```yaml
- type: pause
  duration: 2000  # milliseconds
```

#### Prompt Action (User interaction)
```yaml
- type: prompt
  message: "Scene complete. Press ENTER to continue..."
```

#### Focus Action (Switch pane focus)
```yaml
- type: focus
  pane: cli
```

### 6. Navigation Section
Defines keyboard shortcuts and auto-advance behavior for the presentation.

### 7. Settings Section
Global presentation settings like progress display, step numbers, and logging options.

## How to Use This Configuration

1. Save the YAML configuration to `presentation.yaml`
2. Run the tmux-presenter with: `tmux-presenter present presentation.yaml`
3. The framework will:
   - Parse and validate the configuration
   - Set up the tmux layout
   - Guide you through each step with speaker notes
   - Execute commands in the appropriate panes
   - Handle navigation and user interaction

## Benefits of This Approach

1. **Declarative**: The entire presentation is defined in YAML, not code
2. **Reusable**: The same framework can run any presentation
3. **Maintainable**: Easy to update without touching code
4. **Shareable**: Configuration files can be version controlled and shared
5. **Extensible**: New action types can be added to the framework