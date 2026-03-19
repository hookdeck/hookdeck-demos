import { Action } from '../models/Step';
import { PaneManager } from './PaneManager';
import { PresenterUI } from './PresenterUI';

/**
 * CommandExecutor handles execution of different action types
 */
export class CommandExecutor {
  private paneManager: PaneManager;
  private ui: PresenterUI;
  private env: Record<string, string>;

  constructor(paneManager: PaneManager, ui: PresenterUI, env: Record<string, string> = {}) {
    this.paneManager = paneManager;
    this.ui = ui;
    this.env = env;
  }

  /**
   * Execute a single action
   */
  async executeAction(action: Action): Promise<void> {
    switch (action.type) {
      case 'command':
        await this.executeCommand(action);
        break;
      case 'signal':
        await this.executeSignal(action);
        break;
      case 'pause':
        await this.executePause(action);
        break;
      case 'prompt':
        await this.executePrompt(action);
        break;
      case 'focus':
        await this.executeFocus(action);
        break;
      case 'capture':
        await this.executeCapture(action);
        break;
      case 'keypress':
        await this.executeKeypress(action);
        break;
      case 'display':
        await this.executeDisplay(action);
        break;
      default:
        throw new Error(`Unknown action type: ${(action as Action).type}`);
    }
  }

  /**
   * Execute a command action
   */
  private async executeCommand(action: Action): Promise<void> {
    if (!action.pane) {
      throw new Error('Command action requires a pane');
    }
    if (!action.command) {
      throw new Error('Command action requires a command');
    }

    // Substitute environment variables
    const command = this.substituteEnvVars(action.command);

    if (action.wait) {
      // Type the command without executing, wait for user, then execute
      this.paneManager.executeCommand(action.pane, command, false);
      
      // Small delay to let tmux buffer settle
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Show custom prompt with default instruction, or just default instruction
      const prompt = action.prompt
        ? `${action.prompt}\n⏸️  Press ENTER to continue...`
        : '⏸️  Press ENTER to continue...';
      
      await this.ui.waitForUser(prompt);
      this.paneManager.executeCommand(action.pane, '', true); // Press Enter
    } else {
      // Execute immediately
      this.paneManager.executeCommand(action.pane, command, true);
    }
  }

  /**
   * Execute a signal action (e.g., Ctrl+C)
   */
  private async executeSignal(action: Action): Promise<void> {
    if (!action.pane) {
      throw new Error('Signal action requires a pane');
    }
    if (!action.signal) {
      throw new Error('Signal action requires a signal');
    }

    if (action.wait) {
      // Show custom prompt with default instruction, or just default instruction
      const prompt = action.prompt
        ? `${action.prompt}\n⏸️  Press ENTER to continue...`
        : `⏸️  Press ENTER to continue...`;
      
      await this.ui.waitForUser(prompt);
    }

    this.paneManager.sendSignal(action.pane, action.signal);
  }

  /**
   * Execute a pause action
   */
  private async executePause(action: Action): Promise<void> {
    if (!action.duration) {
      throw new Error('Pause action requires a duration');
    }

    await this.sleep(action.duration);
  }

  /**
   * Execute a prompt action
   */
  private async executePrompt(action: Action): Promise<void> {
    if (!action.message) {
      throw new Error('Prompt action requires a message');
    }

    this.ui.showMessage(action.message);
    await this.ui.waitForUser();
  }

  /**
   * Execute a focus action
   */
  private async executeFocus(action: Action): Promise<void> {
    if (!action.pane) {
      throw new Error('Focus action requires a pane');
    }

    this.paneManager.focusPane(action.pane);
  }

  /**
   * Execute a capture action
   *
   * IMPORTANT: Window Resize Workaround for TUI Applications
   *
   * This action captures text from a tmux pane using regex pattern matching.
   * For TUI applications (like Hookdeck CLI) that truncate output based on terminal width,
   * this implementation can use a temporary window resize workaround (unless skipResize is true):
   *
   * 1. Saves the original terminal window size
   * 2. Temporarily resizes the window to 5000px wide (to maximize column count)
   * 3. Waits for the TUI to detect the resize and re-render with full content
   * 4. Captures the content using tmux capture-pane
   * 5. Immediately restores the original window size
   * 6. Prompts the presenter to verify the window position before continuing
   *
   * Use `skipResize: true` if your terminal window is already large enough to display
   * the full content you're trying to capture. This avoids the window resize workaround.
   *
   * NOTE FOR PRESENTERS: When resize is used, you may see a brief "flash" where the
   * terminal window expands very wide during capture (~1 second). This is expected behavior
   * and necessary to capture truncated URLs or long text that doesn't fit in the normal
   * terminal width. After capture, you'll be prompted to verify the window is correctly
   * positioned before continuing.
   *
   * This workaround is macOS-specific and uses AppleScript to control Terminal.app.
   */
  private async executeCapture(action: Action): Promise<void> {
    if (!action.pane) {
      throw new Error('Capture action requires a pane');
    }
    if (!action.pattern) {
      throw new Error('Capture action requires a pattern');
    }
    if (!action.variable) {
      throw new Error('Capture action requires a variable');
    }

    const timeout = action.timeout || 5000;
    const startTime = Date.now();
    const pollInterval = 100;
    const skipResize = action.skipResize || false;
    
    let originalSize: { width: number; height: number } | null = null;
    
    try {
      // Only do resize workaround if not skipped
      if (!skipResize) {
        // Save original terminal window size
        originalSize = this.paneManager.getTerminalWindowSize();
        
        // Temporarily make the window MUCH wider to get more columns
        // This forces TUI applications to re-render and display full content
        this.paneManager.resizeTerminalWindow(5000, originalSize.height);
        
        // Give the terminal time to resize (this triggers TUI refresh)
        await this.sleep(1000);
        
        // Trigger TUI refresh to ensure it re-renders with new width
        this.paneManager.refreshPane(action.pane);
        await this.sleep(500);
      }
      
      // Poll using capture-pane to get the re-rendered display
      while (Date.now() - startTime < timeout) {
        try {
          // Capture pane content using tmux capture-pane
          const content = this.paneManager.captureContent(action.pane);
          
          const regex = new RegExp(action.pattern);
          const match = regex.exec(content);

          if (match) {
            const capturedValue = match[0];
            // Store in both env objects for consistency
            this.env[action.variable] = capturedValue;
            process.env[action.variable] = capturedValue;
            console.log(`✓ Captured "${capturedValue}" into ${action.variable}`);
            
            // Restore original window size if we resized it
            if (!skipResize && originalSize) {
              console.log(`🖥️  Restoring window to ${originalSize.width}x${originalSize.height}px...`);
              this.paneManager.resizeTerminalWindow(originalSize.width, originalSize.height);
              await this.sleep(300);
              
              // Prompt presenter to verify window position after resize
              await this.ui.waitForUser('🪟 Window restored. Please verify position before continuing...');
            }
            
            return;
          }
        } catch (error) {
          // Continue polling if capture fails
          console.warn(`⚠ Capture attempt failed: ${(error as Error).message}`);
        }

        // Wait before polling again
        await this.sleep(pollInterval);
      }

      throw new Error(
        `Pattern "${action.pattern}" not found in pane ${action.pane} within ${timeout}ms`
      );
    } finally {
      // Always restore original window size if we resized it
      if (!skipResize && originalSize) {
        try {
          console.log(`🖥️  Restoring window to original size...`);
          this.paneManager.resizeTerminalWindow(originalSize.width, originalSize.height);
          await this.sleep(300);
          
          // Prompt presenter to verify window position after resize (even in error case)
          await this.ui.waitForUser('🪟 Window restored. Please verify position before continuing...');
        } catch (restoreError) {
          console.warn(`⚠ Failed to restore window size: ${(restoreError as Error).message}`);
        }
      }
    }
  }

  /**
   * Execute a keypress action
   */
  private async executeKeypress(action: Action): Promise<void> {
    if (!action.pane) {
      throw new Error('Keypress action requires a pane');
    }
    if (!action.key) {
      throw new Error('Keypress action requires a key');
    }

    try {
      const tmuxKey = this.mapKeyToTmux(action.key);
      this.paneManager.sendKeypress(action.pane, tmuxKey);

      if (action.pause && action.pause > 0) {
        await this.sleep(action.pause);
      }
    } catch (error) {
      throw new Error(
        `Failed to send keypress "${action.key}" to pane ${action.pane}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Execute a display action
   * Displays text in a pane without showing the command itself
   */
  private async executeDisplay(action: Action): Promise<void> {
    if (!action.pane) {
      throw new Error('Display action requires a pane');
    }
    if (!action.text) {
      throw new Error('Display action requires text');
    }

    // Substitute environment variables
    const text = this.substituteEnvVars(action.text);

    // Use printf with \r to overwrite the prompt line with just the text
    // This displays the text without showing the command
    const command = `printf '\\r${text.replace(/'/g, "'\\''")}\\n' && printf '$ '`;
    this.paneManager.executeCommand(action.pane, command, true);

    if (action.pause && action.pause > 0) {
      await this.sleep(action.pause);
    }
  }

  /**
   * Map key names to tmux key names
   */
  private mapKeyToTmux(key: string): string {
    const keyMap: { [key: string]: string } = {
      Up: 'Up',
      Down: 'Down',
      Left: 'Left',
      Right: 'Right',
      ESC: 'Escape',
      Enter: 'Enter',
      Space: 'Space',
      Tab: 'Tab',
    };

    return keyMap[key] || key;
  }

  /**
   * Substitute environment variables in a string
   */
  private substituteEnvVars(str: string): string {
    return str.replace(/\$\{([^}]+)\}/g, (match, varName) => {
      const value = this.env[varName] || process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable ${varName} is not defined`);
      }
      return value;
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}