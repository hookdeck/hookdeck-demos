import * as readline from 'readline';

/**
 * ANSI color codes for terminal output
 */
const colors = {
  green: '\x1b[0;32m',
  blue: '\x1b[0;34m',
  yellow: '\x1b[1;33m',
  cyan: '\x1b[0;36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

/**
 * PresenterUI manages the controller terminal interface
 */
export class PresenterUI {
  private currentStep: number = 0;
  private totalSteps: number = 0;

  constructor(totalSteps: number) {
    this.totalSteps = totalSteps;
  }

  /**
   * Display speaker notes with formatting
   */
  showSpeakerNotes(notes: string): void {
    console.log('\n');
    console.log(
      colors.green + '═══════════════════════════════════════════════════════' + colors.reset
    );
    console.log(colors.blue + colors.bold + 'SPEAKER NOTES' + colors.reset);
    console.log(
      colors.green + '═══════════════════════════════════════════════════════' + colors.reset
    );
    console.log(colors.reset + notes);
    console.log(
      colors.green + '═══════════════════════════════════════════════════════' + colors.reset
    );
  }

  /**
   * Show progress indicator
   */
  showProgress(current: number, total: number): void {
    this.currentStep = current;
    this.totalSteps = total;
    
    const percentage = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * 30);
    const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);

    console.log(
      `\n${colors.cyan}Progress: [${bar}] ${percentage}% (${current}/${total})${colors.reset}`
    );
  }

  /**
   * Wait for user input with a custom prompt
   */
  async waitForUser(prompt?: string): Promise<void> {
    const message = prompt || 'Press ENTER to continue...';
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(colors.yellow + message + colors.reset + '\n', () => {
        rl.close();
        resolve();
      });
    });
  }

  /**
   * Display a message box
   */
  showMessage(message: string): void {
    console.log(`\n${colors.green}═══════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.blue}${message}${colors.reset}`);
    console.log(`${colors.green}═══════════════════════════════════════════════════════${colors.reset}`);
  }

  /**
   * Display an error message
   */
  showError(error: string): void {
    console.error(`\n${colors.yellow}ERROR: ${error}${colors.reset}\n`);
  }

  /**
   * Display a success message
   */
  showSuccess(message: string): void {
    console.log(`\n${colors.green}✓ ${message}${colors.reset}\n`);
  }

  /**
   * Display step title
   */
  showStepTitle(stepNumber: number, title: string): void {
    console.log(
      `\n${colors.bold}${colors.cyan}Step ${stepNumber}/${this.totalSteps}: ${title}${colors.reset}\n`
    );
  }

  /**
   * Clear the screen (only clears for step transitions, not before speaker notes)
   */
  clear(): void {
    // Don't clear - keep building the output
  }

  /**
   * Display welcome message
   */
  showWelcome(presentationName: string, description?: string): void {
    console.clear();
    console.log(colors.green + '═════════════════════════════════════════════════════════════' + colors.reset);
    console.log(colors.bold + colors.blue + '  TMUX PRESENTER' + colors.reset);
    console.log(colors.green + '═════════════════════════════════════════════════════════════' + colors.reset);
    console.log(`\n${colors.cyan}${colors.bold}${presentationName}${colors.reset}\n`);
    if (description) {
      console.log(`${colors.reset}${description}\n`);
    }
    console.log(colors.green + '═════════════════════════════════════════════════════════════' + colors.reset);
  }

  /**
   * Display completion message
   */
  showCompletion(sessionName: string): void {
    console.log(`\n${colors.green}${colors.bold}Presentation complete!${colors.reset}`);
    console.log(`${colors.yellow}The tmux session is still running.${colors.reset}`);
    console.log(`${colors.yellow}To close it: tmux kill-session -t ${sessionName}${colors.reset}\n`);
  }
}