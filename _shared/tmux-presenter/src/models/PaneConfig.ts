/**
 * Pane configuration for tmux layout
 */
export interface PaneConfig {
  id: string;
  title: string;
  position: number;
  width?: string;
  defaultFocus?: boolean;
  initialCommand?: string;
}

/**
 * Terminal spawn configuration
 */
export interface TerminalConfig {
  spawn: boolean;
  title?: string;
  width?: number;
  height?: number;
  fontSize?: number; // Font size in points (macOS Terminal.app only)
  maximize?: boolean; // Maximize the terminal window (macOS Terminal.app only, overrides width/height)
}

/**
 * Layout configuration defining the tmux session structure
 */
export interface Layout {
  sessionName: string;
  terminal?: TerminalConfig;
  panes: PaneConfig[];
}