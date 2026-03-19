import { Layout } from './PaneConfig';
import { Step } from './Step';

/**
 * Environment variable definition
 */
export interface EnvironmentVariable {
  name: string;
  required?: boolean;
  source?: string;
  description?: string;
}

/**
 * Environment configuration
 */
export interface Environment {
  variables?: EnvironmentVariable[];
  workingDirectory?: string;
}

/**
 * Presentation metadata
 */
export interface PresentationMetadata {
  name: string;
  duration?: string;
  description?: string;
}

/**
 * Complete presentation configuration
 */
export interface Presentation {
  metadata: PresentationMetadata;
  environment: Environment;
  layout: Layout;
  steps: Step[];
}