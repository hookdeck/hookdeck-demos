import { TmuxController } from './TmuxController';
import { Layout, PaneConfig } from '../models/PaneConfig';

/**
 * Pane represents a managed tmux pane with its metadata
 */
class Pane {
  constructor(
    public id: string,
    public index: number,
    public title: string
  ) {}

  getTarget(sessionName: string): string {
    return `${sessionName}:0.${this.index}`;
  }
}

/**
 * PaneManager handles pane lifecycle and layout management
 */
export class PaneManager {
  private panes: Map<string, Pane> = new Map();
  private tmux: TmuxController;
  private sessionName: string;

  constructor(tmux: TmuxController) {
    this.tmux = tmux;
    this.sessionName = tmux.getSessionName();
  }

  /**
   * Create the entire pane layout from configuration
   */
  async createLayout(config: Layout, workDir: string): Promise<void> {
    // Kill existing session if it exists
    if (this.tmux.sessionExists()) {
      this.tmux.killSession();
    }

    // Create new session
    this.tmux.createSession(workDir);

    // Wait for session to be ready
    await this.sleep(500);

    // Create additional panes (first pane already exists)
    for (let i = 1; i < config.panes.length; i++) {
      const target = `${this.sessionName}:0.${i - 1}`;
      this.tmux.splitPane(target, true);
    }

    // Apply even-horizontal layout for automatic resizing
    this.tmux.setLayout(`${this.sessionName}:0`, 'even-horizontal');

    // Set hook to automatically reapply layout on window resize
    this.tmux.setHook(
      'after-resize-pane',
      `select-layout -t '${this.sessionName}:0' even-horizontal`
    );

    // Create pane objects and set titles FIRST
    for (const [index, paneConfig] of config.panes.entries()) {
      const pane = new Pane(paneConfig.id, index, paneConfig.title);
      this.panes.set(paneConfig.id, pane);

      // Set pane title
      this.tmux.setPaneTitle(pane.getTarget(this.sessionName), paneConfig.title);
    }

    // Focus the default pane BEFORE running any commands
    const defaultPane = config.panes.find((p) => p.defaultFocus);
    if (defaultPane) {
      this.focusPane(defaultPane.id);
    }

    // Now run initialization commands with focus already set
    // Note: Panes inherit working directory from session creation, no cd needed
    for (const [index, paneConfig] of config.panes.entries()) {
      if (paneConfig.initialCommand) {
        // If initial command is "clear", use Ctrl-L instead to avoid % character
        if (paneConfig.initialCommand === 'clear') {
          this.tmux.sendSignal(this.panes.get(paneConfig.id)!.getTarget(this.sessionName), 'C-l');
        } else {
          this.executeCommand(paneConfig.id, paneConfig.initialCommand);
        }
      } else {
        // Default to Ctrl-L (clear screen) instead of clear command
        this.tmux.sendSignal(this.panes.get(paneConfig.id)!.getTarget(this.sessionName), 'C-l');
      }
    }
  }

  /**
   * Execute a command in a specific pane
   */
  executeCommand(paneId: string, command: string, execute: boolean = true): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.sendKeys(pane.getTarget(this.sessionName), command, execute);
  }

  /**
   * Send a signal to a specific pane
   */
  sendSignal(paneId: string, signal: string): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.sendSignal(pane.getTarget(this.sessionName), signal);
  }

  /**
   * Clear the content of a specific pane
   */
  clearPane(paneId: string): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.clearPane(pane.getTarget(this.sessionName));
  }

  /**
   * Focus a specific pane
   */
  focusPane(paneId: string): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.selectPane(pane.getTarget(this.sessionName));
  }

  /**
   * Capture content from a specific pane
   */
  captureContent(paneId: string): string {
    const pane = this.getPaneOrThrow(paneId);
    return this.tmux.capturePane(pane.getTarget(this.sessionName));
  }

  /**
   * Get the current width of a specific pane
   */
  getPaneWidth(paneId: string): number {
    const pane = this.getPaneOrThrow(paneId);
    return this.tmux.getPaneWidth(pane.getTarget(this.sessionName));
  }

  /**
   * Get the window width (total terminal width)
   */
  getWindowWidth(paneId: string): number {
    const pane = this.getPaneOrThrow(paneId);
    return this.tmux.getWindowWidth(pane.getTarget(this.sessionName));
  }

  /**
   * Resize a specific pane to a given width
   */
  resizePaneWidth(paneId: string, width: number): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.resizePaneWidth(pane.getTarget(this.sessionName), width);
  }

  /**
   * Maximize a pane to take up the full window
   */
  maximizePane(paneId: string): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.maximizePane(pane.getTarget(this.sessionName));
  }

  /**
   * Get the current layout of the window
   */
  getCurrentLayout(): string {
    const windowTarget = `${this.sessionName}:0`;
    return this.tmux.getCurrentLayout(windowTarget);
  }

  /**
   * Restore a specific layout to the window
   */
  restoreLayout(layout: string): void {
    const windowTarget = `${this.sessionName}:0`;
    this.tmux.restoreLayout(windowTarget, layout);
  }

  /**
   * Refresh a specific pane (trigger TUI re-render)
   */
  refreshPane(paneId: string): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.refreshPane(pane.getTarget(this.sessionName));
  }

  /**
   * Get the session name
   */
  getSessionName(): string {
    return this.sessionName;
  }

  /**
   * Set the terminal font size (macOS specific)
   */
  setTerminalFontSize(fontSize: number): void {
    this.tmux.setTerminalFontSize(fontSize);
  }

  /**
   * Resize the terminal window (macOS specific)
   */
  resizeTerminalWindow(width: number, height: number): void {
    this.tmux.resizeTerminalWindow(width, height);
  }

  /**
   * Get the current terminal window size (macOS specific)
   */
  getTerminalWindowSize(): { width: number; height: number } {
    return this.tmux.getTerminalWindowSize();
  }

  /**
   * Send a keypress to a specific pane
   */
  sendKeypress(paneId: string, key: string): void {
    const pane = this.getPaneOrThrow(paneId);
    this.tmux.sendKeypress(pane.getTarget(this.sessionName), key);
  }
  /**
   * Get a pane by ID or throw error
   */
  private getPaneOrThrow(paneId: string): Pane {
    const pane = this.panes.get(paneId);
    if (!pane) {
      throw new Error(`Pane '${paneId}' not found`);
    }
    return pane;
  }

  /**
   * Check if a pane exists
   */
  hasPane(paneId: string): boolean {
    return this.panes.has(paneId);
  }

  /**
   * Get all pane IDs
   */
  getPaneIds(): string[] {
    return Array.from(this.panes.keys());
  }

  /**
   * Clean up - kill the session
   */
  cleanup(): void {
    this.tmux.killSession();
    this.panes.clear();
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}