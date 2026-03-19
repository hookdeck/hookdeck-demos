# Tmux Presenter Framework - Refactoring Plan

## Current State Analysis

The current `walkthrough.ts` is tightly coupled to the session-filters demo with:
- Hardcoded pane layout (3-way split)
- Hardcoded commands and sequences
- Embedded speaker notes in waitForUser calls
- Demo-specific logic throughout
- No separation between presentation logic and tmux control

## Proposed Architecture

### 1. Core Framework Components

```
tmux-presenter/
├── src/
│   ├── core/
│   │   ├── TmuxController.ts      # Tmux session management
│   │   ├── PaneManager.ts         # Pane creation and control
│   │   ├── CommandExecutor.ts     # Command execution in panes
│   │   └── PresenterUI.ts         # Controller terminal UI
│   ├── models/
│   │   ├── Presentation.ts        # Presentation data model
│   │   ├── Step.ts                # Step definition
│   │   └── PaneConfig.ts          # Pane configuration
│   ├── parsers/
│   │   └── ConfigParser.ts        # Parse YAML/JSON configs
│   └── index.ts                   # Main entry point
```

### 2. Configuration Schema

```yaml
# presentation.yaml
metadata:
  name: "Hookdeck CLI Demo"
  duration: "2 minutes"
  description: "Interactive Mode & Session Filters"

environment:
  variables:
    - name: HOOKDECK_URL
      required: true
      source: .env
  workingDirectory: ./

layout:
  sessionName: hookdeck-demo
  terminal:
    spawn: true  # Spawn new terminal window
    position: right  # Position relative to controller
  panes:
    - id: sender
      title: "WEBHOOK SENDER"
      position: left
      width: 33%
    - id: cli
      title: "HOOKDECK CLI"
      position: center
      width: 34%
      defaultFocus: true
    - id: server
      title: "SERVER"
      position: right
      width: 33%

steps:
  - id: scene1_setup
    title: "Scene 1 - Setup and show the noise"
    duration: "40s"
    speaker_notes: |
      ## Scene 1 - Setup and show the noise (40s)
      Starting the server...
      This will demonstrate the noise problem.
      
      ### Talking Points:
      - Simple local server that logs webhooks
      - Interactive mode is on by default
    actions:
      - type: command
        pane: server
        command: "npm run server"
        wait: true
        prompt: "Press ENTER to start the server..."
      - type: pause
        duration: 2000
      
  - id: scene1_listen
    title: "Starting hookdeck listen (without filters)"
    speaker_notes: |
      The new Interactive mode is on by default.
      You'll see a live terminal view of incoming events.
    actions:
      - type: command
        pane: cli
        command: "hookdeck listen 3000 github --path /webhooks/github"
        wait: true
        prompt: "Press ENTER to start hookdeck listen..."
      - type: pause
        duration: 3000

  - id: scene1_noise
    title: "Triggering webhook noise"
    speaker_notes: |
      This will send multiple event types:
      - push events
      - issues events
      - pull_request events
      - star events
      
      Notice all the different event types coming through.
    actions:
      - type: command
        pane: sender
        command: "npm run webhooks -- --url ${HOOKDECK_URL} --verbose --loops 2"
        wait: true
        prompt: "Press ENTER to trigger webhook noise..."
      - type: prompt
        message: "Scene 1 complete. Notice all the different event types."

  - id: scene2_filter
    title: "Scene 2 - Apply session filters"
    duration: "35s"
    speaker_notes: |
      ## Scene 2 - Apply session filters (35s)
      
      Session filters narrow the stream to only events you care about.
      Filtering happens in the Hookdeck Event Gateway.
    actions:
      - type: signal
        pane: cli
        signal: "C-c"
        prompt: "Press ENTER to stop hookdeck listen..."
      - type: pause
        duration: 1000
      - type: command
        pane: cli
        command: "hookdeck listen 3000 github --path /webhooks/github --filter-headers '{\"x-github-event\":\"pull_request\"}'"
        wait: true
        prompt: "Press ENTER to restart with session filter..."
      - type: pause
        duration: 3000
      - type: command
        pane: sender
        command: "npm run webhooks -- --url ${HOOKDECK_URL} --verbose --loops 1"
        wait: true
        prompt: "Press ENTER to trigger webhooks again (filtered)..."
      - type: prompt
        message: "Scene 2 complete. Only pull_request events were received!"

  - id: scene3_interactive
    title: "Scene 3 - Explore with interactive mode"
    duration: "30s"
    speaker_notes: |
      ## Scene 3 - Explore with interactive mode (30s)
      
      Interactive mode keyboard shortcuts:
      - ↑↓ - Navigate events
      - d  - View details
      - r  - Retry delivery
      - o  - Open in dashboard
      - q  - Quit
      
      Let the audience explore the UI.
    actions:
      - type: prompt
        message: |
          In the Hookdeck CLI pane, you can:
            ↑↓ - Navigate events
            d  - View details
            r  - Retry delivery
            o  - Open in dashboard
            q  - Quit
          
          Try interacting with the events now.

  - id: scene4_wrapup
    title: "Scene 4 - Wrap-up"
    duration: "10-15s"
    speaker_notes: |
      ## Scene 4 - Wrap-up (10-15s)
      
      Key takeaways:
      - Session filters keep local testing focused
      - Interactive mode provides clear visibility
      - Direct inspect and replay from terminal
    actions:
      - type: prompt
        message: |
          Demo complete!
          
          To stop all processes:
          - Ctrl+C in each pane
          - Or exit tmux: 'tmux kill-session -t hookdeck-demo'
```

### 3. TypeScript Interfaces

```typescript
// Core interfaces
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

interface Layout {
  sessionName: string;
  terminal?: TerminalConfig;
  panes: PaneConfig[];
}

interface Step {
  id: string;
  title: string;
  duration?: string;
  speakerNotes?: string;
  actions: Action[];
}

interface Action {
  type: 'command' | 'signal' | 'pause' | 'prompt' | 'focus';
  pane?: string;
  command?: string;
  signal?: string;
  duration?: number;
  message?: string;
  prompt?: string;
  wait?: boolean;
}

// Presenter Controller
interface PresenterController {
  // Load presentation from config file
  loadPresentation(configPath: string): Promise<Presentation>;
  
  // Start the presentation
  start(): Promise<void>;
  
  // Navigation controls
  nextStep(): Promise<void>;
  previousStep(): Promise<void>;
  goToStep(stepId: string): Promise<void>;
  
  // Pane controls
  executeInPane(paneId: string, command: string): Promise<void>;
  focusPane(paneId: string): void;
  
  // UI updates
  showSpeakerNotes(notes: string): void;
  showProgress(current: number, total: number): void;
}
```

### 4. Implementation Classes

```typescript
// TmuxController.ts
export class TmuxController {
  private sessionName: string;
  
  async createSession(name: string, workDir: string): Promise<void> {
    // Kill existing session if exists
    await this.killSession(name);
    // Create new session
    await this.exec(`new-session -d -s ${name} -c ${workDir}`);
  }
  
  async splitPane(target: string, horizontal: boolean = true): Promise<void> {
    const flag = horizontal ? '-h' : '-v';
    await this.exec(`split-window ${flag} -t "${target}"`);
  }
  
  async sendKeys(target: string, keys: string): Promise<void> {
    await this.exec(`send-keys -t "${target}" "${keys}"`);
  }
  
  async setLayout(target: string, layout: string): Promise<void> {
    await this.exec(`select-layout -t "${target}" ${layout}`);
  }
  
  private async exec(command: string): Promise<string> {
    return execSync(`tmux ${command}`, { encoding: 'utf8' });
  }
}

// PaneManager.ts
export class PaneManager {
  private panes: Map<string, Pane>;
  private tmux: TmuxController;
  
  async createLayout(config: Layout): Promise<void> {
    // Create session
    await this.tmux.createSession(config.sessionName, process.cwd());
    
    // Create panes based on configuration
    for (let i = 1; i < config.panes.length; i++) {
      await this.tmux.splitPane(`${config.sessionName}:0.${i-1}`);
    }
    
    // Apply layout
    await this.tmux.setLayout(`${config.sessionName}:0`, 'even-horizontal');
    
    // Initialize panes
    for (const [index, paneConfig] of config.panes.entries()) {
      const pane = new Pane(paneConfig.id, index, paneConfig.title);
      this.panes.set(paneConfig.id, pane);
      await this.tmux.setPaneTitle(
        `${config.sessionName}:0.${index}`,
        paneConfig.title
      );
    }
  }
  
  async executeCommand(paneId: string, command: string): Promise<void> {
    const pane = this.panes.get(paneId);
    if (!pane) throw new Error(`Pane ${paneId} not found`);
    
    await this.tmux.sendKeys(
      `${this.sessionName}:0.${pane.index}`,
      command
    );
  }
}

// PresenterUI.ts
export class PresenterUI {
  private currentStep: number = 0;
  private steps: Step[];
  
  showSpeakerNotes(notes: string): void {
    console.clear();
    console.log(colors.green + '═══════════════════════════════════════════════════════');
    console.log(colors.blue + 'SPEAKER NOTES');
    console.log(colors.green + '═══════════════════════════════════════════════════════');
    console.log(colors.reset + notes);
    console.log(colors.green + '═══════════════════════════════════════════════════════');
  }
  
  showProgress(current: number, total: number): void {
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * 30);
    const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);
    
    console.log(`\nProgress: [${bar}] ${percentage}% (${current}/${total})`);
  }
  
  async waitForUser(prompt?: string): Promise<void> {
    const message = prompt || 'Press ENTER to continue...';
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise((resolve) => {
      rl.question(colors.yellow + message + colors.reset, () => {
        rl.close();
        resolve();
      });
    });
  }
}
```

### 5. Usage Examples

```typescript
// CLI Usage
// tmux-presenter present ./presentation.yaml

// Programmatic usage
import { TmuxPresenter } from 'tmux-presenter';

const presenter = new TmuxPresenter();
await presenter.load('./presentation.yaml');
await presenter.start();

// Using the builder pattern
import { PresentationBuilder } from 'tmux-presenter';

const presentation = new PresentationBuilder()
  .setTitle('My Demo')
  .addPane({ id: 'main', title: 'Main', position: 'left' })
  .addPane({ id: 'logs', title: 'Logs', position: 'right' })
  .addStep({
    title: 'Step 1',
    speakerNotes: 'Start the demo...',
    actions: [
      { type: 'command', pane: 'main', command: 'echo "Hello"' }
    ]
  })
  .build();

const presenter = new TmuxPresenter();
await presenter.run(presentation);
```

## Migration Strategy

### Phase 1: Extract Core Components (Week 1)
1. Create TmuxController class with basic tmux operations
2. Build PaneManager for layout management
3. Implement CommandExecutor for command execution
4. Create PresenterUI for controller interface

### Phase 2: Configuration System (Week 2)
1. Define TypeScript interfaces for all configuration types
2. Implement YAML parser with schema validation
3. Add environment variable substitution
4. Create configuration validator

### Phase 3: Runtime Engine (Week 3)
1. Build StepExecutor for running actions
2. Add navigation controls (next, previous, goto)
3. Implement speaker notes display
4. Add progress tracking

### Phase 4: Migration & Testing (Week 4)
1. Convert existing walkthrough.ts to use new framework
2. Create presentation.yaml for session-filters demo
3. Test both implementations side-by-side
4. Document migration process

## Benefits

1. **Reusability**: Any tmux-based demo can use this framework
2. **Maintainability**: Presentations are declarative YAML, not code
3. **Flexibility**: Easy to modify presentations without changing code
4. **Collaboration**: Non-developers can create/edit presentations
5. **Version Control**: Text-based configs are diff-friendly
6. **Testing**: Each component can be unit tested independently

## Future Enhancements

- **Recording Mode**: Capture presentations as videos
- **Templates**: Pre-built layouts for common scenarios
- **Plugins**: Custom action types for specific domains
- **Remote Control**: Web-based controller interface
- **Analytics**: Track which steps take longest, common issues
- **Multi-Language**: Support for different programming languages in examples

## Next Steps

1. Review and approve this plan
2. Create the tmux-presenter package structure
3. Implement core components
4. Build a minimal viable prototype
5. Test with session-filters demo
6. Gather feedback and iterate