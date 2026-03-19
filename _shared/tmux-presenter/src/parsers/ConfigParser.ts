import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Presentation } from '../models/Presentation';

/**
 * ConfigParser handles parsing and validation of presentation configuration files
 */
export class ConfigParser {
  /**
   * Parse a YAML configuration file
   */
  static parseYaml(filePath: string): Presentation {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Configuration file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const config = yaml.load(content) as Presentation;

    // Validate the configuration
    this.validate(config);

    return config;
  }

  /**
   * Validate presentation configuration
   */
  private static validate(config: Presentation): void {
    if (!config.metadata?.name) {
      throw new Error('Presentation must have a name in metadata');
    }

    if (!config.layout?.sessionName) {
      throw new Error('Presentation must define a session name in layout');
    }

    if (!config.layout?.panes || config.layout.panes.length === 0) {
      throw new Error('Presentation must define at least one pane');
    }

    if (!config.steps || config.steps.length === 0) {
      throw new Error('Presentation must define at least one step');
    }

    // Validate each step has required fields
    config.steps.forEach((step, index) => {
      if (!step.id) {
        throw new Error(`Step at index ${index} must have an id`);
      }
      if (!step.title) {
        throw new Error(`Step '${step.id}' must have a title`);
      }
      if (!step.actions || step.actions.length === 0) {
        throw new Error(`Step '${step.id}' must have at least one action`);
      }
    });
  }

  /**
   * Load environment variables from a .env file
   */
  static loadEnvFile(envPath: string): Record<string, string> {
    const env: Record<string, string> = {};

    if (!fs.existsSync(envPath)) {
      return env;
    }

    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return;
      }

      // Parse KEY=value format
      const match = line.match(/^([^#][^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();
        env[key] = value;
      }
    });

    return env;
  }

  /**
   * Load and merge environment variables from presentation config
   */
  static loadEnvironment(
    config: Presentation,
    baseDir: string
  ): Record<string, string> {
    const env: Record<string, string> = {};

    // Load from .env file if specified
    if (config.environment?.variables) {
      for (const varDef of config.environment.variables) {
        if (varDef.source) {
          const envPath = path.resolve(baseDir, varDef.source);
          const loadedEnv = this.loadEnvFile(envPath);
          Object.assign(env, loadedEnv);
        }
      }
    }

    // Validate required variables
    if (config.environment?.variables) {
      for (const varDef of config.environment.variables) {
        if (varDef.required) {
          const value = env[varDef.name] || process.env[varDef.name];
          if (!value) {
            throw new Error(
              `Required environment variable '${varDef.name}' is not set. ${
                varDef.description || ''
              }`
            );
          }
          env[varDef.name] = value;
        }
      }
    }

    return env;
  }

  /**
   * Get working directory from config or use default
   */
  static getWorkingDirectory(config: Presentation, baseDir: string): string {
    const workDir = config.environment?.workingDirectory || './';
    return path.resolve(baseDir, workDir);
  }
}