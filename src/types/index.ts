/**
 * Domain Type Exports
 * Complete TypeScript domain model for SAM Flow AI
 */

// Company
export type { Company, CreateCompanyDTO, UpdateCompanyDTO } from './company.types';

// User
export type {
  User,
  UserRole,
  StageOfBusiness,
  CreateUserDTO,
  UpdateUserDTO,
} from './user.types';

// Product
export type {
  Product,
  ProductTicketTier,
  RevenueType,
  CreateProductDTO,
  UpdateProductDTO,
} from './product.types';

// Plan
export type {
  AnnualPlan,
  QuarterlyPlan,
  MonthlyPlan,
  WeeklyPlan,
  PlanningHorizon,
  PlanStatus,
  CreateAnnualPlanDTO,
  UpdateAnnualPlanDTO,
} from './plan.types';

// Planning Input
export type {
  PlanningInput,
  IntakeRoute,
  TimeframeOption,
  CreatePlanningInputDTO,
  UpdatePlanningInputDTO,
} from './planning-input.types';

// Initiative Type
export type {
  InitiativeType,
  DifficultyDimensions,
  DifficultyLevel,
  InitiativeOwner,
  BenchmarkScenario,
  ConversionBenchmarks,
  ProjectTemplate,
  ProjectTemplateTask,
  CreateInitiativeTypeDTO,
  UpdateInitiativeTypeDTO,
} from './initiative-type.types';

// Initiative
export type {
  Initiative,
  RecurringTemplate,
  InitiativeKind,
  InitiativeStatus,
  RevenueScenarios,
  CreateInitiativeDTO,
  UpdateInitiativeDTO,
  CreateRecurringTemplateDTO,
  UpdateRecurringTemplateDTO,
} from './initiative.types';

// Task
export type {
  Task,
  TaskStatus,
  TaskPriority,
  CreateTaskDTO,
  UpdateTaskDTO,
} from './task.types';

// Result
export type {
  InitiativeResult,
  EvergreenResult,
  Result,
  ResultSource,
  CreateInitiativeResultDTO,
  CreateEvergreenResultDTO,
  UpdateResultDTO,
} from './result.types';

// Projection
export type {
  Projection,
  ProjectionSummary,
  MonthlyProjection,
  QuarterlyProjection,
  ScenarioType,
  ProjectionPeriod,
  CreateProjectionDTO,
  UpdateProjectionDTO,
} from './projection.types';

// Benchmark
export type {
  Benchmark,
  BenchmarkData,
  ConversionBenchmark,
  CostBenchmark,
  BenchmarkSource,
  BenchmarkLibrary,
  CreateConversionBenchmarkDTO,
  CreateCostBenchmarkDTO,
  UpdateBenchmarkDTO,
} from './benchmark.types';

// Expense
export type {
  Expense,
  ExpenseCategory,
  ExpenseSource,
  InitiativeExpenseSummary,
  CreateExpenseDTO,
  UpdateExpenseDTO,
} from './expense.types';

// Report
export type {
  Report,
  ReportType,
  ReportSummary,
  RevenueByProduct,
  RevenueByInitiative,
  ExpenseByCategory,
  ROIAnalysis,
  CreateReportDTO,
} from './report.types';

// Subscription
export type {
  Subscription,
  SubscriptionTier,
  SubscriptionStatus,
  BillingCycle,
  SubscriptionTierConfig,
  BenchmarkParticipation,
  CreateSubscriptionDTO,
  UpdateSubscriptionDTO,
  UpgradeSubscriptionDTO,
  UpdateBenchmarkParticipationDTO,
} from './subscription.types';

export { TIER_CONFIGS } from './subscription.types';

// Permissions & Roles
export type {
  PermissionScope,
  PermissionDefinition,
  Role,
  RolePermission,
  RoleWithPermissions,
  PermissionCategory,
  InternalTeamMember,
} from './permission.types';

// Subscription Plans (admin-configurable)
export type {
  SubscriptionPlan,
  SubscriptionPlanFull,
  PlanLimit,
  PlanFeature,
  CreateSubscriptionPlanDTO,
  UpdateSubscriptionPlanDTO,
  LimitKey,
  FeatureKey,
} from './subscription-plan.types';

export { LIMIT_KEYS, FEATURE_KEYS } from './subscription-plan.types';
