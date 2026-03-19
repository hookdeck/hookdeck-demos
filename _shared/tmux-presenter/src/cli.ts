#!/usr/bin/env node

import { TmuxPresenter } from './index';

/**
 * CLI entry point for tmux-presenter
 */
async function main() {
  const args = process.argv.slice(2);

  // Show help if no arguments or help flag
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  // Check for version flag
  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0);
  }

  // Parse command
  const command = args[0];

  if (command === 'present') {
    const configFile = args[1];
    
    if (!configFile) {
      console.error('Error: Configuration file path is required');
      console.error('Usage: tmux-presenter present <config-file>');
      process.exit(1);
    }

    try {
      const presenter = new TmuxPresenter();
      await presenter.load(configFile);
      await presenter.start();
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }
}

/**
 * Display help text
 */
function showHelp() {
  console.log(`
tmux-presenter - A framework for creating automated, interactive tmux-based presentations

USAGE:
  tmux-presenter <command> [options]

COMMANDS:
  present <config-file>    Start a presentation from a YAML configuration file

OPTIONS:
  -h, --help              Show this help message
  -v, --version           Show version information

EXAMPLES:
  tmux-presenter present ./presentation.yaml
  tmux-presenter present ./demos/my-demo.yaml

CONFIGURATION:
  Presentations are defined in YAML files. See documentation for details:
  https://github.com/hookdeck/tmux-presenter

REQUIREMENTS:
  - tmux must be installed on your system
  - Node.js 16+ recommended
  `);
}

/**
 * Display version information
 */
function showVersion() {
  // In a real implementation, this would read from package.json
  console.log('tmux-presenter version 0.1.0');
}

// Run the CLI
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});