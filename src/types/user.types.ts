/**
 * User domain types
 * Represents a user account in the system (for Phase 11 auth and beyond)
 */

export type UserRole = 'owner' | 'operator' | 'team_member' | 'viewer';

export interface User {
  id: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  marketingSignature?: string;
  stageOfBusiness?: StageOfBusiness;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type StageOfBusiness =
  | 'early_stage'
  | 'scaling'
  | 'established_1m'
  | 'established_10m'
  | 'enterprise';

export interface CreateUserDTO {
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  marketingSignature?: string;
  stageOfBusiness?: StageOfBusiness;
}

export interface UpdateUserDTO {
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  marketingSignature?: string;
  stageOfBusiness?: StageOfBusiness;
  isActive?: boolean;
}
