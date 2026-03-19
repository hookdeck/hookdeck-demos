/**
 * Action types that can be performed during a presentation step
 */
export type ActionType = 'command' | 'signal' | 'pause' | 'prompt' | 'focus' | 'capture' | 'keypress' | 'display';

/**
 * Action to be performed during a step
 */
export interface Action {
  type: ActionType;
  pane?: string;
  command?: string;
  signal?: string;
  duration?: number;
  message?: string;
  prompt?: string;
  wait?: boolean;
  // Command action properties
  captureOutput?: boolean;  // Start pipe-pane before executing command
  typeSpeed?: number;
  // Capture action properties
  pattern?: string;
  variable?: string;
  timeout?: number;
  skipResize?: boolean;  // Skip window resize workaround for capture (use when terminal is already large enough)
  // Keypress action properties
  key?: string;
  pause?: number;
  // Display action properties
  text?: string;  // Text to display in pane (without showing as a command)
}

/**
 * A step in the presentation
 */
export interface Step {
  id: string;
  title: string;
  duration?: string;
  speakerNotes?: string;
  actions: Action[];
}