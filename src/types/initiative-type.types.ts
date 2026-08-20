/**
 * Initiative Type domain types
 * The library of initiative types with benchmarks, templates, and metadata
 * STORED AS DATA - not code. Adding a new type is a content task.
 */

export type InitiativeOwner = 'system' | 'user';
export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface BenchmarkScenario {
  conservative: number;
  moderate: number;
  aggressive: number;
}

export interface ConversionBenchmarks {
  [key: string]: BenchmarkScenario;
}

export interface DifficultyDimensions {
  effortToImplement: DifficultyLevel; // total task-hours
  skillExpertiseRequired: DifficultyLevel; // can solo non-marketer do it?
  timeToResults: DifficultyLevel; // how fast does it pay off?
  costToRun: DifficultyLevel; // money required
}

export interface ProjectTemplateTask {
  id: string;
  name: string;
  description: string;
  daysBeforeEvent: number; // relative to event date (e.g., -21 for 21 days before)
  estimatedHours: number;
  estimatedHoursRange?: {
    min: number;
    max: number;
  };
  roles: string[]; // e.g., ['marketer', 'designer', 'copywriter']
  dependencies: string[]; // task IDs that must complete first
  displayOrder: number;
}

export interface ProjectTemplate {
  tasks: ProjectTemplateTask[];
  totalEstimatedHours: number;
}

export interface InitiativeType {
  id: string;
  name: string;
  channel: string; // e.g., 'webinar', 'email', 'paid_ads'
  description: string;
  owner: InitiativeOwner;
  // Benchmarks: different fields per type
  benchmarks: ConversionBenchmarks;
  // Project template for execution
  projectTemplate: ProjectTemplate;
  // Difficulty dimensions
  difficulty: DifficultyDimensions;
  // AI context for generator
  aiContext: {
    description: string; // when to recommend
    sizingGuidance: string; // how to size it
    recommendationWeights: {
      budget?: number;
      timeframe?: number;
      teamSize?: number;
      assets?: number;
    };
  };
  // Own vs. Ops (future dimension)
  ownVsOpsFlag?: boolean;
  // Metadata
  tier: 1 | 2 | 3; // tier 1 = core, tier 2 = next wave, tier 3 = long tail
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateInitiativeTypeDTO {
  name: string;
  channel: string;
  description?: string;
  benchmarks: ConversionBenchmarks;
  projectTemplate: ProjectTemplate;
  difficulty: DifficultyDimensions;
  aiContext: {
    description: string;
    sizingGuidance: string;
    recommendationWeights?: Partial<InitiativeType['aiContext']['recommendationWeights']>;
  };
  tier?: 1 | 2 | 3;
  displayOrder?: number;
}

export interface UpdateInitiativeTypeDTO {
  name?: string;
  description?: string;
  benchmarks?: ConversionBenchmarks;
  projectTemplate?: ProjectTemplate;
  difficulty?: Partial<DifficultyDimensions>;
  aiContext?: Partial<InitiativeType['aiContext']>;
  isActive?: boolean;
  displayOrder?: number;
}
