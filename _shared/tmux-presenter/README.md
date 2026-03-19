# tmux-presenter

A framework for creating automated, interactive tmux-based presentations with speaker notes. Perfect for live demos, technical talks, and interactive tutorials.

## Features

- **Declarative Configuration**: Define presentations in YAML with steps, actions, and speaker notes
- **Tmux Integration**: Automatic multi-pane terminal layouts for complex demos
- **Speaker Notes**: Built-in presenter view with markdown-formatted notes
- **Interactive Control**: Step-by-step execution with user prompts
- **Environment Management**: Load environment variables and validate prerequisites
- **Reusable**: Write once, present many times with consistent results

## Installation

### Local Development

```bash
npm install
npm run build
```

### As a Dependency (Future)

```bash
npm install tmux-presenter
```

## Quick Start

1. Create a presentation configuration file (see [YAML Configuration](#yaml-configuration-guide) section below)
2. Run the presenter:

```bash
# Using npx (if installed globally)
tmux-presenter present ./presentation.yaml

# Or using npm scripts
npm run present ./presentation.yaml
```

## CLI Usage

### Commands

```bash
# Run a presentation
tmux-presenter present <config-file>

# Show help
tmux-presenter --help

# Show version
tmux-presenter --version
```

### Options

- `-h, --help` - Show help message
- `-v, --version` - Show version information

### Requirements

- tmux must be installed on your system
- Node.js 16+ recommended
- macOS (for terminal spawning feature, optional)

## YAML Configuration Guide

Presentations are defined in YAML files with the following structure:

### Complete Structure

```yaml
metadata:
  name: "Presentation Title"
  duration: "5 minutes"
  description: |
    Multi-line description of your presentation

environment:
  variables:
    - name: VARIABLE_NAME
      required: true
      source: .env
      description: "What this variable is for"
  workingDirectory: ./

layout:
  sessionName: my-demo-session
  terminal:
    spawn: true
    title: "Presentation View"
    width: 1200      # Window width in pixels (ignored if maximize: true)
    height: 600      # Window height in pixels (ignored if maximize: true)
    fontSize: 11     # Font size in points (macOS Terminal.app only, default: 11)
    maximize: false  # Maximize window (macOS only, overrides width/height)
  panes:
    - id: pane1
      title: "PANE TITLE"
      position: 0
      width: 50%
      defaultFocus: true
      initialCommand: "clear"

steps:
  - id: step1
    title: "Step Title"
    duration: "30s"
    speakerNotes: |
      Your speaker notes here
    actions:
      - type: command
        pane: pane1
        command: "echo 'Hello World'"

navigation:
  shortcuts:
    - key: "n"
      action: "next"
  autoAdvance:
    enabled: false

settings:
  showProgress: true
  logCommands: true
```

### Configuration Sections

#### 1. Metadata

Basic information about your presentation.

```yaml
metadata:
  name: "Your Presentation Name"        # Required
  duration: "10 minutes"                # Optional
  description: "What this demo shows"   # Optional
```

#### 2. Environment

Environment variables and working directory configuration.

```yaml
environment:
  variables:
    - name: API_KEY                     # Variable name
      required: true                    # Fail if not found
      source: .env                      # Load from .env file
      description: "API authentication" # Help text
  workingDirectory: ./                  # Base directory (relative to YAML file)
```

**How it works:**
- If `source` is specified, variables are loaded from that `.env` file
- `required: true` will cause presentation to fail if variable is not set
- Variables can use `${VARIABLE_NAME}` syntax in commands
- Working directory is resolved relative to the YAML file location

#### 3. Layout

Tmux session and pane configuration.

```yaml
layout:
  sessionName: my-session              # Required: tmux session name
  terminal:                            # Optional: spawn new terminal
    spawn: true                        # Open new terminal window (macOS only)
    title: "Presentation View"
    width: 1200                        # Window width in pixels (ignored if maximize: true)
    height: 600                        # Window height in pixels (ignored if maximize: true)
    fontSize: 11                       # Font size in points (macOS only, default: 11)
    maximize: false                    # Maximize window (macOS only, overrides width/height)
  panes:                               # Required: at least one pane
    - id: terminal1                    # Unique pane identifier
      title: "SERVER"                  # Display title
      position: 0                      # Left-to-right position
      width: 33%                       # Width percentage
      defaultFocus: true               # Focus this pane on start
      initialCommand: "clear"          # Run on pane creation
```

**Terminal configuration options:**
- `spawn`: Whether to open a new terminal window (macOS only)
- `title`: Window title (optional)
- `width`: Window width in pixels (default: 1200, ignored if `maximize: true`)
- `height`: Window height in pixels (default: 600, ignored if `maximize: true`)
- `fontSize`: Font size in points (default: 11, macOS Terminal.app only)
- `maximize`: Maximize the terminal window (default: false, macOS only, overrides width/height)

**Note:** The `maximize` option uses macOS accessibility features to maximize the terminal window to fill available screen space (excluding menu bar and dock). When enabled, `width` and `height` settings are ignored.

**Layout behavior:**
- Panes are arranged horizontally from left to right
- Even-horizontal layout is applied automatically
- Layout reapplies on terminal resize
- Pane widths are distributed evenly regardless of `width` setting (feature limitation)

#### 4. Steps

The presentation steps with actions and speaker notes.

```yaml
steps:
  - id: intro                          # Required: unique step ID
    title: "Introduction"              # Required: step title
    duration: "30s"                    # Optional: reference only (not enforced)
    speakerNotes: |                    # Optional: presenter notes
      What to say during this step.
      Supports multiple lines.
    actions:                           # Required: at least one action
      - type: command
        pane: terminal1
        command: "npm start"
```

**Note on `duration`:** The step-level `duration` field is optional and used only as a reference/planning tool. It is NOT enforced by the framework and does not affect execution timing. For actual timing control, use the `pause` action with its `duration` parameter (in milliseconds).

### Action Types

All action types with detailed examples:

#### `command` - Execute a command

Execute a shell command in a specific pane.

```yaml
# Basic command (executes immediately)
- type: command
  pane: server
  command: "npm run dev"

# Type command and wait for user to press Enter
- type: command
  pane: cli
  command: "hookdeck listen 3000"
  wait: true

# Type command with custom prompt
- type: command
  pane: sender
  command: "curl https://api.example.com"
  wait: true
  prompt: "Press ENTER to send the request..."

# Use environment variables
- type: command
  pane: terminal1
  command: "curl ${HOOKDECK_URL}/webhook"
```

**Parameters:**
- `pane` (required): Target pane ID
- `command` (required): Command to execute
- `wait` (optional): If true, types command but waits for user to press Enter
- `prompt` (optional): Custom message when `wait: true`

**Environment Variables:**
- Use `${VAR_NAME}` syntax in commands
- Variables are substituted from environment configuration
- Throws error if required variable is not defined

#### `signal` - Send keyboard signal

Send keyboard signals like Ctrl+C to a pane.

```yaml
# Stop a running process
- type: signal
  pane: server
  signal: "C-c"

# With user prompt
- type: signal
  pane: cli
  signal: "C-c"
  wait: true
  prompt: "Press ENTER to stop the CLI..."
```

**Parameters:**
- `pane` (required): Target pane ID
- `signal` (required): Signal to send (e.g., `C-c` for Ctrl+C, `C-d` for Ctrl+D)
- `wait` (optional): Wait for user before sending signal
- `prompt` (optional): Custom message when `wait: true`

#### `pause` - Wait for duration

Pause execution for a specific time period.

```yaml
# Wait 2 seconds
- type: pause
  duration: 2000

# Wait 5 seconds
- type: pause
  duration: 5000
```

**Parameters:**
- `duration` (required): Milliseconds to wait

#### `prompt` - Display message and wait

Show a message to the presenter and wait for acknowledgment.

```yaml
# Simple prompt
- type: prompt
  message: "Press ENTER to continue..."

# Detailed instructions
- type: prompt
  message: |
    Next we'll demonstrate the interactive mode.
    
    Action: Manually navigate the CLI interface.
    
    Press ENTER when ready to continue...
```

**Parameters:**
- `message` (required): Message to display

**Where it appears:**
- Prompts are displayed in the **presenter terminal** (where you run `tmux-presenter present`)
- NOT shown in the presentation window (tmux session)
- Private to the presenter, not visible to the audience

**Use case:** Perfect for pausing the presentation so you can manually interact with the tmux panes (e.g., navigate a UI, demonstrate features, or wait for processes to complete). You perform the actions in the presentation window, then press ENTER in your presenter terminal to continue to the next step.

#### `focus` - Switch pane focus

Change which pane has focus in the tmux session.

```yaml
# Focus the CLI pane
- type: focus
  pane: cli

# Focus before demonstration
- type: focus
  pane: server
```

**Parameters:**
- `pane` (required): Target pane ID to focus

#### `capture` - Capture text from pane output

Capture text from pane output using regex and store it as an environment variable for use in subsequent commands.

```yaml
# Capture URL from CLI output (with resize)
- type: capture
  pane: cli
  pattern: "https://hkdk\\.events/[a-z0-9]+"
  variable: HOOKDECK_URL
  timeout: 5000  # optional, default: 5000ms

# Capture without resizing (when terminal is already large enough)
- type: capture
  pane: cli
  pattern: "https://hkdk\\.events/[a-z0-9]+"
  variable: HOOKDECK_URL
  skipResize: true  # skip window resize workaround
```

**Parameters:**
- `pane` (required): Pane ID to capture from
- `pattern` (required): Regex pattern to match
- `variable` (required): Variable name to store captured value
- `timeout` (optional): Max time to wait for pattern in milliseconds (default: 5000)
- `skipResize` (optional): Skip window resize workaround (default: false)

**How it works:**
- Reads pane content using `tmux capture-pane`
- Applies regex pattern to find match
- Extracts captured text (first match, group 0)
- Stores as environment variable (accessible via `${VARIABLE}` in subsequent commands)
- Polls every 100ms until pattern found or timeout reached
- Throws error if pattern not found within timeout

**⚠️ IMPORTANT - TUI Width Workaround (macOS only):**

For TUI applications that truncate output based on terminal width (like Hookdeck CLI), the capture action can use a temporary window resize workaround (unless `skipResize: true`):

1. Saves the original terminal window size
2. Temporarily resizes the window to 5000px wide to maximize columns
3. Waits for the TUI to detect the resize and re-render with full content
4. Captures the content using tmux capture-pane
5. Immediately restores the original window size
6. **Prompts the presenter to verify the window position before continuing**

**When to use `skipResize: true`:**
- Your terminal window is already large enough to display the full content
- You want to avoid the window resize flash
- You know the text you're capturing fits within the current terminal width

**Note for presenters:**
- When resize is used, you may see a brief "flash" where the terminal window expands very wide during capture (~1 second). This is expected behavior and necessary to capture truncated URLs or long text.
- **After the window is restored, you will be prompted to verify the window is correctly positioned before continuing.** This is because the resize may not restore the window to its exact original position. Press ENTER once you've verified or adjusted the window position.
- If `skipResize: true` is set, no window resizing occurs and no verification prompt is shown.

**Example use case:**
```yaml
# Capture URL from Hookdeck CLI listen output (with resize and verification)
- type: capture
  pane: cli
  pattern: "https://hkdk\\.events/[a-z0-9]+"
  variable: HOOKDECK_URL
  timeout: 5000
  
# Use captured URL in subsequent command
- type: command
  pane: sender
  command: "curl ${HOOKDECK_URL}/webhook"
```



#### `keypress` - Send keypresses for TUI navigation

Send individual keypresses to panes for automated TUI (Text User Interface) navigation.

```yaml
# Navigate down in a TUI
- type: keypress
  pane: cli
  key: "Down"
  pause: 500  # wait 500ms after keypress

# Press 'd' to view details
- type: keypress
  pane: cli
  key: "d"
  pause: 2000

# Press ESC to go back
- type: keypress
  pane: cli
  key: "ESC"
```

**Parameters:**
- `pane` (required): Pane ID to send keypress to
- `key` (required): Key to press
- `pause` (optional): Milliseconds to wait after keypress (default: 0)

**Supported keys:**
- **Arrow keys:** `Up`, `Down`, `Left`, `Right`
- **Special keys:** `Enter`, `ESC`, `Space`, `Tab`
- **Character keys:** `a-z`, `A-Z`, `0-9`, and symbols (e.g., `d`, `r`, `q`)

**How it works:**
- Maps special key names to tmux key names (e.g., `ESC` → `Escape`)
- Sends keypress using `tmux send-keys`
- Waits for specified pause duration after keypress
- Character keys pass through as-is

**Example use case:**
```yaml
# Automate navigation in Hookdeck CLI interactive mode
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
  key: "d"  # View details
  pause: 2000

- type: keypress
  pane: cli
  key: "ESC"  # Go back
  pause: 500
```


### Speaker Notes vs Prompt

Understanding when to use each:

**`speakerNotes`** (Step-level):
- Displayed at the **start of each step**
- Shown in the presenter terminal (not visible in presentation window)
- Contains talking points, context, and instructions
- Supports markdown formatting
- Best for: What to say, background context, step overview

```yaml
steps:
  - id: demo_filtering
    title: "Session Filters Demo"
    speakerNotes: |
      # Explain Session Filters
      
      Session filters let you narrow the event stream to only what you care about.
      The filtering happens server-side in the Hookdeck Event Gateway.
      
      Now I'll restart the CLI with a filter applied...
    actions:
      - type: command
        pane: cli
        command: "hookdeck listen 3000 --filter-headers '{\"type\":\"webhook\"}'"
```

**`prompt` action**:
- Used **during step execution**
- Pauses the presentation for user interaction
- Can provide custom instructions for what to do
- Best for: Manual interactions, waiting for processes, demonstrations

```yaml
steps:
  - id: manual_demo
    title: "Interactive Features"
    speakerNotes: |
      Now demonstrate the interactive mode features manually.
    actions:
      - type: focus
        pane: cli
      - type: prompt
        message: |
          Demo the following:
          - Press 'd' to view event details
          - Press 'r' to replay an event
          - Press 'o' to open in dashboard
          
          Press ENTER when demonstration is complete...
```

### Real Example

Here's a complete example from [`session-filters/presentation.yaml`](../../hookdeck/session-filters/presentation.yaml:1):

```yaml
metadata:
  name: "Hookdeck CLI Demo – Interactive Mode & Session Filters"
  duration: "2 minutes"
  description: |
    Demonstrates how Hookdeck CLI's interactive mode and session filters
    help developers debug webhooks faster.

environment:
  variables:
    - name: HOOKDECK_URL
      required: true
      source: .env
      description: "Your Hookdeck endpoint URL"
  workingDirectory: ./

layout:
  sessionName: hookdeck-demo
  terminal:
    spawn: true
    title: "Hookdeck Demo - Presentation View"
    width: 1200
    height: 600
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
  - id: setup
    title: "Setup"
    speakerNotes: |
      Let's start by running our local server.
    actions:
      - type: command
        pane: server
        command: "npm run server"
        wait: true
        prompt: "Starting the server..."
      - type: pause
        duration: 2000

  - id: start_cli
    title: "Start Hookdeck CLI"
    speakerNotes: |
      Now start the Hookdeck CLI in interactive mode.
    actions:
      - type: command
        pane: cli
        command: "hookdeck listen 3000 github --path /webhooks/github"
        wait: true
        prompt: "Starting hookdeck listen..."
      - type: pause
        duration: 3000

  - id: send_webhooks
    title: "Trigger Webhooks"
    speakerNotes: |
      Send a burst of various webhook types to show the noise.
    actions:
      - type: command
        pane: sender
        command: "npm run webhooks -- --url ${HOOKDECK_URL} --verbose"
        wait: true
        prompt: "Triggering webhooks..."
```

### Best Practices

1. **Structure your steps logically**: Each step should represent a clear phase of your demo
2. **Use descriptive IDs**: Make step and pane IDs self-documenting
3. **Balance automation and control**: Use `wait: true` for important moments where you want to narrate
4. **Include speaker notes**: Even if you know the demo, notes help with consistency
5. **Test with pauses**: Add small pauses after commands that need time to start
6. **Use environment variables**: Keep sensitive data in `.env` files, not in YAML
7. **Focus strategically**: Use `focus` actions to direct audience attention
8. **Provide context in prompts**: When using `prompt` actions, explain what to do

## Programmatic API Guide

The framework can be used programmatically in TypeScript/JavaScript applications.

### Basic Usage

```typescript
import { TmuxPresenter } from 'tmux-presenter';

async function runPresentation() {
  const presenter = new TmuxPresenter();
  
  // Load presentation from YAML
  await presenter.load('./presentation.yaml');
  
  // Start the presentation
  await presenter.start();
}

runPresentation().catch(console.error);
```

### Core Classes

#### TmuxPresenter

Main class for running presentations.

```typescript
import { TmuxPresenter } from 'tmux-presenter';

const presenter = new TmuxPresenter();

// Load configuration
await presenter.load(configPath: string): Promise<void>

// Start presentation
await presenter.start(): Promise<void>

// Get current state
presenter.getCurrentStepIndex(): number
presenter.getPresentation(): Presentation | undefined

// Cleanup
presenter.cleanup(): void
```

**Methods:**

- `load(configPath)` - Parse and load YAML configuration file
- `start()` - Begin presentation execution
- `getCurrentStepIndex()` - Get current step index (0-based)
- `getPresentation()` - Get loaded presentation object
- `cleanup()` - Kill tmux session and clean up resources

#### ConfigParser

Parse and validate YAML configurations.

```typescript
import { ConfigParser } from 'tmux-presenter';

// Parse YAML file
const presentation = ConfigParser.parseYaml(filePath: string): Presentation

// Load environment variables
const env = ConfigParser.loadEnvironment(
  config: Presentation,
  baseDir: string
): Record<string, string>

// Get working directory
const workDir = ConfigParser.getWorkingDirectory(
  config: Presentation,
  baseDir: string
): string

// Load .env file
const envVars = ConfigParser.loadEnvFile(envPath: string): Record<string, string>
```

#### TmuxController

Low-level tmux session operations.

```typescript
import { TmuxController } from 'tmux-presenter';

const tmux = new TmuxController(sessionName: string);

// Session management
TmuxController.checkTmuxInstalled(): boolean
tmux.sessionExists(): boolean
tmux.createSession(workDir: string): void
tmux.killSession(): void

// Pane operations
tmux.splitPane(target: string, horizontal: boolean): void
tmux.sendKeys(target: string, keys: string, execute: boolean): void
tmux.sendSignal(target: string, signal: string): void
tmux.selectPane(target: string): void
tmux.setPaneTitle(target: string, title: string): void

// Layout
tmux.setLayout(target: string, layout: string): void
tmux.setHook(hookName: string, command: string): void

// Terminal spawning (macOS)
tmux.spawnTerminalWithTmux(projectDir: string): void
```

#### PaneManager

High-level pane lifecycle management.

```typescript
import { PaneManager, TmuxController } from 'tmux-presenter';

const tmux = new TmuxController('my-session');
const paneManager = new PaneManager(tmux);

// Create layout from config
await paneManager.createLayout(config: Layout, workDir: string): Promise<void>

// Execute commands
paneManager.executeCommand(paneId: string, command: string, execute?: boolean): void
paneManager.sendSignal(paneId: string, signal: string): void
paneManager.focusPane(paneId: string): void

// Query panes
paneManager.hasPane(paneId: string): boolean
paneManager.getPaneIds(): string[]

// Cleanup
paneManager.cleanup(): void
```

#### CommandExecutor

Execute presentation actions.

```typescript
import { CommandExecutor, PaneManager, PresenterUI } from 'tmux-presenter';

const executor = new CommandExecutor(
  paneManager: PaneManager,
  ui: PresenterUI,
  env: Record<string, string>
);

// Execute any action type
await executor.executeAction(action: Action): Promise<void>
```

#### PresenterUI

Presenter terminal interface.

```typescript
import { PresenterUI } from 'tmux-presenter';

const ui = new PresenterUI(totalSteps: number);

// Display methods
ui.showWelcome(presentationName: string, description?: string): void
ui.showStepTitle(stepNumber: number, title: string): void
ui.showSpeakerNotes(notes: string): void
ui.showProgress(current: number, total: number): void
ui.showMessage(message: string): void
ui.showError(error: string): void
ui.showSuccess(message: string): void
ui.showCompletion(sessionName: string): void

// User interaction
await ui.waitForUser(prompt?: string): Promise<void>

// Screen control
ui.clear(): void
```

### Type Definitions

```typescript
// Presentation structure
interface Presentation {
  metadata: PresentationMetadata;
  environment: Environment;
  layout: Layout;
  steps: Step[];
}

interface PresentationMetadata {
  name: string;
  duration?: string;
  description?: string;
}

interface Environment {
  variables?: EnvironmentVariable[];
  workingDirectory?: string;
}

interface EnvironmentVariable {
  name: string;
  required?: boolean;
  source?: string;
  description?: string;
}

// Layout configuration
interface Layout {
  sessionName: string;
  terminal?: TerminalConfig;
  panes: PaneConfig[];
}

interface PaneConfig {
  id: string;
  title: string;
  position: number;
  width?: string;
  defaultFocus?: boolean;
  initialCommand?: string;
}

interface TerminalConfig {
  spawn: boolean;
  title?: string;
  width?: number;
  height?: number;
}

// Steps and actions
interface Step {
  id: string;
  title: string;
  duration?: string;
  speakerNotes?: string;
  actions: Action[];
}

type ActionType = 'command' | 'signal' | 'pause' | 'prompt' | 'focus';

interface Action {
  type: ActionType;
  pane?: string;
  command?: string;
  signal?: string;
  duration?: number;
  message?: string;
  prompt?: string;
  wait?: boolean;
}
```

### Integration Example

Here's a complete example showing how to use the API:

```typescript
import {
  TmuxPresenter,
  ConfigParser,
  TmuxController,
  PaneManager,
  PresenterUI,
  CommandExecutor
} from 'tmux-presenter';

async function customPresentation() {
  // Check prerequisites
  if (!TmuxController.checkTmuxInstalled()) {
    console.error('tmux is not installed!');
    process.exit(1);
  }

  // Load and parse configuration
  const presentation = ConfigParser.parseYaml('./my-demo.yaml');
  const baseDir = process.cwd();
  const env = ConfigParser.loadEnvironment(presentation, baseDir);
  const workDir = ConfigParser.getWorkingDirectory(presentation, baseDir);

  // Initialize components
  const ui = new PresenterUI(presentation.steps.length);
  const tmux = new TmuxController(presentation.layout.sessionName);
  const paneManager = new PaneManager(tmux);
  const executor = new CommandExecutor(paneManager, ui, env);

  // Show welcome
  ui.showWelcome(
    presentation.metadata.name,
    presentation.metadata.description
  );
  await ui.waitForUser('Press ENTER to begin...');

  // Create layout
  await paneManager.createLayout(presentation.layout, workDir);

  // Execute steps
  for (let i = 0; i < presentation.steps.length; i++) {
    const step = presentation.steps[i];
    
    ui.clear();
    ui.showStepTitle(i + 1, step.title);
    
    if (step.speakerNotes) {
      ui.showSpeakerNotes(step.speakerNotes);
    }
    
    ui.showProgress(i + 1, presentation.steps.length);

    // Execute all actions
    for (const action of step.actions) {
      await executor.executeAction(action);
    }
  }

  // Completion
  ui.showCompletion(presentation.layout.sessionName);
  
  // Optional: cleanup
  // paneManager.cleanup();
}

customPresentation().catch(console.error);
```

### Exported Modules

All public interfaces and classes are exported from the main index:

```typescript
// Main class
export { TmuxPresenter } from './index';

// Models
export { Presentation, PresentationMetadata, Environment } from './models/Presentation';
export { Step, Action, ActionType } from './models/Step';
export { PaneConfig, Layout, TerminalConfig } from './models/PaneConfig';

// Core components
export { ConfigParser } from './parsers/ConfigParser';
export { TmuxController } from './core/TmuxController';
export { PaneManager } from './core/PaneManager';
export { CommandExecutor } from './core/CommandExecutor';
export { PresenterUI } from './core/PresenterUI';
```

## Project Structure

```
tmux-presenter/
├── src/
│   ├── core/              # Core framework components
│   │   ├── TmuxController.ts    # Low-level tmux operations
│   │   ├── PaneManager.ts       # Pane lifecycle management
│   │   ├── CommandExecutor.ts   # Action execution engine
│   │   └── PresenterUI.ts       # Presenter terminal interface
│   ├── models/            # Data models
│   │   ├── Presentation.ts      # Presentation structure
│   │   ├── Step.ts             # Step and action definitions
│   │   └── PaneConfig.ts       # Layout configuration
│   ├── parsers/           # Configuration parsers
│   │   └── ConfigParser.ts     # YAML parser and validator
│   ├── cli.ts            # CLI entry point
│   └── index.ts          # Library exports
├── docs/                  # Documentation
└── examples/              # Example presentations
```

## Development Status

✅ **Core Implementation Complete**

The tmux-presenter framework is fully implemented and functional. Here's what's working:

### ✅ Implemented Features

- **Core Framework**
  - [`TmuxPresenter`](./src/index.ts:13) class with full presentation lifecycle
  - [`TmuxController`](./src/core/TmuxController.ts:6) for low-level tmux operations
  - [`PaneManager`](./src/core/PaneManager.ts:22) for layout and pane management
  - [`CommandExecutor`](./src/core/CommandExecutor.ts:8) for action execution
  - [`PresenterUI`](./src/core/PresenterUI.ts:18) for presenter terminal interface

- **YAML Configuration**
  - Complete YAML parser with validation
  - Support for all configuration sections (metadata, environment, layout, steps)
  - Environment variable loading from `.env` files
  - Working directory configuration

- **Action Types** (All Implemented)
  - `command` - Execute commands in panes with optional wait
  - `signal` - Send keyboard signals (Ctrl+C, etc.)
  - `pause` - Wait for specified duration
  - `prompt` - Display messages and wait for user input
  - `focus` - Switch focus between panes

- **Pane Management**
  - Multi-pane horizontal layouts
  - Even distribution with automatic resizing
  - Pane titles and initial commands
  - Focus management

- **CLI Tool**
  - `present` command to run presentations
  - Help and version flags
  - Error handling and validation

### ⏳ Not Yet Implemented

Features mentioned in the YAML example but not yet implemented:

- **Navigation Shortcuts**: The `navigation` section in YAML (keyboard shortcuts for next/previous/restart) is defined but not implemented
- **Settings**: The `settings` section fields (`showProgress`, `confirmBeforeQuit`, etc.) are parsed but not all are active
- **Environment Checks**: The `environment.checks` array for prerequisite validation is not implemented
- **Recording Mode**: Session recording is not implemented
- **PresentationBuilder API**: The programmatic builder pattern shown in old README is not implemented

## Roadmap

Future enhancements:

- [ ] Navigation shortcuts (next/previous/goto step)
- [ ] Environment prerequisite checks
- [ ] Settings implementation (confirmBeforeQuit, etc.)
- [ ] Session recording mode
- [ ] PresentationBuilder programmatic API
- [ ] Template library
- [ ] Plugin system
- [ ] Cross-platform terminal spawning

## Contributing

This project is part of the Hookdeck demo repository. Contributions are welcome!

## License

MIT

## Related Projects

- **session-filters**: Hookdeck CLI demo using tmux-presenter
- **deduplication**: Event deduplication demo