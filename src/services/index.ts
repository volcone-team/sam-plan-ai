/**
 * Service Layer Exports
 * 
 * All services are abstracted behind this interface.
 * This is the ONLY way the UI accesses data.
 * No mock data is exposed directly.
 */

// Company & Organization
export { CompanyService, companyService } from './company.service';
export { UserService, userService } from './user.service';

// Products & Offerings
export { ProductService, productService } from './product.service';

// Planning
export { PlanService, planService } from './plan.service';
export { PlanningService, planningService } from './planning.service';
export { QuestionnaireService, questionnaireService } from './questionnaire.service';

// Execution
export { InitiativeService, initiativeService } from './initiative.service';
export { InitiativeTypeService, initiativeTypeService } from './initiative-type.service';
export { TaskService, taskService } from './task.service';
export { ResultService, resultService } from './result.service';

// Analytics
export { ProjectionService, projectionService } from './projection.service';
export { BenchmarkService, benchmarkService } from './benchmark.service';
export { ExpenseService, expenseService } from './expense.service';
export { ReportService, reportService } from './report.service';

/**
 * Usage in Components:
 * 
 * import { companyService, initiativeService } from '@/services';
 * 
 * const company = await companyService.getCompany();
 * const initiatives = await initiativeService.getInitiativesByCompany(companyId);
 * 
 * Services handle:
 * - Data transformation
 * - Business logic (ROI calculation, lead-time, status transitions)
 * - Mock data abstraction (ready to swap to Supabase)
 * - Type safety (all responses are fully typed)
 */
