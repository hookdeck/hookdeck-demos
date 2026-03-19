import { execSync } from 'child_process';

/**
 * TmuxController manages low-level tmux session and pane operations
 */
export class TmuxController {
  private sessionName: string;

  constructor(sessionName: string) {
    this.sessionName = sessionName;
  }

  /**
   * Check if tmux is installed on the system
   */
  static checkTmuxInstalled(): boolean {
    try {
      execSync('which tmux', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a tmux session exists
   */
  sessionExists(): boolean {
    try {
      execSync(`tmux has-session -t "${this.sessionName}" 2>/dev/null`, {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill an existing tmux session
   */
  killSession(): void {
    try {
      this.exec(`kill-session -t "${this.sessionName}"`);
    } catch {
      // Session doesn't exist, ignore error
    }
  }

  /**
   * Create a new tmux session
   */
  createSession(workDir: string): void {
    this.exec(`new-session -d -s "${this.sessionName}" -c "${workDir}"`);
  }

  /**
   * Split a pane horizontally or vertically
   */
  splitPane(target: string, horizontal: boolean = true): void {
    const flag = horizontal ? '-h' : '-v';
    this.exec(`split-window ${flag} -t "${target}"`);
  }

  /**
   * Send keys to a specific pane using literal mode
   * This prevents the shell from interpreting backslash continuations during paste
   */
  sendKeys(target: string, keys: string, execute: boolean = true): void {
    // Strip trailing newlines to prevent empty command execution
    // (which causes directory listings in zsh)
    const trimmedKeys = keys.replace(/\n+$/, '');
    
    // Escape single quotes in the command for shell
    const escapedKeys = trimmedKeys.replace(/'/g, "'\\''");
    
    // Use send-keys with -l (literal) flag to send the text exactly as-is
    // This prevents shell interpretation during typing
    execSync(`tmux send-keys -l -t "${target}" '${escapedKeys}'`, {
      stdio: 'inherit',
    });
    
    // If execute is true, send Enter to execute the command
    if (execute) {
      execSync(`tmux send-keys -t "${target}" Enter`, {
        stdio: 'inherit',
      });
    }
  }

  /**
   * Send a signal (like Ctrl+C) to a pane
   */
  sendSignal(target: string, signal: string): void {
    this.exec(`send-keys -t "${target}" ${signal}`);
  }

  /**
   * Clear the content of a pane
   */
  clearPane(target: string): void {
    // Send clear command
    this.exec(`send-keys -t "${target}" C-l`);
  }

  /**
   * Set the layout for a window
   */
  setLayout(target: string, layout: string): void {
    this.exec(`select-layout -t "${target}" ${layout}`);
  }

  /**
   * Set pane title
   */
  setPaneTitle(target: string, title: string): void {
    this.exec(`select-pane -t "${target}" -T "${title}"`);
  }

  /**
   * Select/focus a specific pane
   */
  selectPane(target: string): void {
    this.exec(`select-pane -t "${target}"`);
  }

  /**
   * Set a hook for the session
   */
  setHook(hookName: string, command: string): void {
    this.exec(`set-hook -t "${this.sessionName}" ${hookName} "${command}"`);
  }

  /**
   * Capture pane content with maximum buffer size
   * Uses -S to capture extensive scrollback history
   * ANSI escape codes are automatically stripped by default (no -e flag)
   */
  capturePane(target: string): string {
    // Capture with maximum tmux history buffer (32768 lines)
    const content = this.exec(`capture-pane -p -S -32768 -t "${target}"`);
    // Strip remaining ANSI escape codes manually
    return content.replace(/\x1b\[[0-9;]*m/g, '').replace(/\x1b\[.*?[@-~]/g, '');
  }

  /**
   * Get the current width of a pane
   */
  getPaneWidth(target: string): number {
    const output = this.exec(`display-message -p -t "${target}" "#{pane_width}"`);
    return parseInt(output.trim(), 10);
  }

  /**
   * Get the window width (total terminal width)
   */
  getWindowWidth(target: string): number {
    const output = this.exec(`display-message -p -t "${target}" "#{window_width}"`);
    return parseInt(output.trim(), 10);
  }

  /**
   * Resize a pane to a specific width (in columns)
   */
  resizePaneWidth(target: string, width: number): void {
    this.exec(`resize-pane -t "${target}" -x ${width}`);
  }

  /**
   * Break a pane out into its own window temporarily
   */
  breakPaneToWindow(target: string): void {
    this.exec(`break-pane -d -t "${target}"`);
  }

  /**
   * Join a pane from another window back into the current window
   */
  joinPaneFromWindow(sourceWindow: string, target: string, position: string = 'after'): void {
    const direction = position === 'after' ? '-h' : '-v';
    this.exec(`join-pane ${direction} -s "${sourceWindow}" -t "${target}"`);
  }

  /**
   * Maximize a pane to take up the full window (zoom)
   */
  maximizePane(target: string): void {
    this.exec(`resize-pane -t "${target}" -Z`);
  }

  /**
   * Get the current layout of the window
   */
  getCurrentLayout(target: string): string {
    return this.exec(`display-message -p -t "${target}" "#{window_layout}"`).trim();
  }

  /**
   * Restore a specific layout to the window
   */
  restoreLayout(target: string, layout: string): void {
    this.exec(`select-layout -t "${target}" "${layout}"`);
  }

  /**
   * Send Ctrl-L to refresh the display (trigger TUI re-render)
   */
  refreshPane(target: string): void {
    this.exec(`send-keys -t "${target}" C-l`);
  }

  /**
   * Send a single keypress to a pane
   */
  sendKeypress(target: string, key: string): void {
    this.exec(`send-keys -t "${target}" ${key}`);
  }

  /**
   * Spawn a new terminal window with tmux session (macOS specific)
   * @param projectDir - The project directory to cd into
   * @param fontSize - Font size in points (default: 11)
   * @param width - Window width in pixels (default: 1200)
   * @param height - Window height in pixels (default: 600)
   * @param maximize - If true, maximize the window to fill available screen space (overrides width/height)
   */
  spawnTerminalWithTmux(
    projectDir: string,
    fontSize: number = 11,
    width: number = 1200,
    height: number = 600,
    maximize: boolean = false
  ): void {
    let script: string;
    
    if (maximize) {
      // Maximize window to fill available screen space (not full screen mode)
      // This calculates the usable screen bounds (excluding menu bar and dock)
      script = `
        tell application "Terminal"
          do script "cd '${projectDir}' && tmux attach-session -t ${this.sessionName}"
          set font size of window 1 to ${fontSize}
          
          -- Get the visible frame (screen size minus menu bar and dock)
          tell application "Finder"
            set screenBounds to bounds of window of desktop
            set screenWidth to item 3 of screenBounds
            set screenHeight to item 4 of screenBounds
          end tell
          
          -- Menu bar is ~23px, dock varies but we use safe margins
          -- Set bounds to fill available space: {left, top, right, bottom}
          set bounds of window 1 to {0, 23, screenWidth, screenHeight}
          activate
        end tell
      `;
    } else {
      // Use specified width and height
      script = `
        tell application "Terminal"
          do script "cd '${projectDir}' && tmux attach-session -t ${this.sessionName}"
          set font size of window 1 to ${fontSize}
          set bounds of window 1 to {0, 0, ${width}, ${height}}
          activate
        end tell
      `;
    }
    
    execSync(`osascript -e '${script}'`, { stdio: 'inherit' });
  }

  /**
   * Close the terminal window that's running the tmux session (macOS specific)
   * This finds and closes ONLY the window with our specific tmux session
   */
  closeSpawnedTerminal(): void {
    const script = `
      tell application "Terminal"
        set targetSession to "${this.sessionName}"
        repeat with w in windows
          try
            set windowContents to contents of w as text
            if windowContents contains targetSession then
              close w
              exit repeat
            end if
          end try
        end repeat
      end tell
    `;
    try {
      execSync(`osascript -e '${script}'`, { stdio: 'ignore' });
    } catch (error) {
      // Ignore errors if window is already closed or not found
      console.warn('Warning: Unable to close spawned terminal window.');
    }
  }

  /**
   * Set the font size of the active Terminal window (macOS specific)
   */
  setTerminalFontSize(fontSize: number): void {
    const script = `
      tell application "Terminal"
        set font size of front window to ${fontSize}
      end tell
    `;
    execSync(`osascript -e '${script}'`, { stdio: 'inherit' });
  }

  /**
   * Resize the Terminal window to specific dimensions (macOS specific)
   */
  resizeTerminalWindow(width: number, height: number): void {
    const script = `
      tell application "Terminal"
        set bounds of front window to {0, 0, ${width}, ${height}}
      end tell
    `;
    execSync(`osascript -e '${script}'`, { stdio: 'inherit' });
  }

  /**
   * Get the current Terminal window size (macOS specific)
   */
  getTerminalWindowSize(): { width: number; height: number } {
    const script = `
      tell application "Terminal"
        get bounds of front window
      end tell
    `;
    const result = execSync(`osascript -e '${script}'`).toString().trim();
    // Result format: "0, 23, 1440, 823" (left, top, right, bottom)
    const [, , right, bottom] = result.split(', ').map(Number);
    return { width: right, height: bottom };
  }

  /**
   * Execute a tmux command
   */
  private exec(command: string): string {
    try {
      return execSync(`tmux ${command}`, { encoding: 'utf8' });
    } catch (error) {
      throw new Error(`Tmux command failed: ${command}\n${error}`);
    }
  }

  /**
   * Get the session name
   */
  getSessionName(): string {
    return this.sessionName;
  }
}