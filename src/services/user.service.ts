/**
 * User Service
 * Manages team members, roles, and access.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type { User, CreateUserDTO, UpdateUserDTO } from '@/types';
import { isSupabaseConfigured, getSupabase, camelToSnake } from '@/lib/supabase/db';
import usersData from '@/mock-data/users.json';

export class UserService {
  /**
   * Get all users in a company
   */
  async getUsersByCompany(companyId: string): Promise<User[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToUser(row));
        }
      } catch {
        // Fall through to mock
      }
    }

    await this.delay();
    return usersData
      .filter(u => u.companyId === companyId)
      .map(u => this.transformMockData(u));
  }

  /**
   * Get a specific user
   */
  async getUser(id: string): Promise<User> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) {
          return this.mapRowToUser(data);
        }
      } catch {
        // Fall through to mock
      }
    }

    await this.delay();
    const user = usersData.find(u => u.id === id);
    if (!user) throw new Error(`User ${id} not found`);
    return this.transformMockData(user);
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', email)
          .single();

        if (!error && data) {
          return this.mapRowToUser(data);
        }
        return null;
      } catch {
        // Fall through to mock
      }
    }

    await this.delay();
    const user = usersData.find(u => u.email === email);
    return user ? this.transformMockData(user) : null;
  }

  /**
   * Create a new user
   */
  async createUser(dto: CreateUserDTO): Promise<User> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          company_id: dto.companyId,
          email: dto.email,
          first_name: dto.firstName,
          last_name: dto.lastName,
          role: dto.role || 'team_member',
          marketing_signature: dto.marketingSignature || null,
          stage_of_business: dto.stageOfBusiness || null,
        };

        const { data, error } = await supabase
          .from('profiles')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) {
          return this.mapRowToUser(data);
        }
      } catch {
        // Fall through to mock
      }
    }

    await this.delay();
    const newUser = {
      id: `user-${Date.now()}`,
      ...dto,
      role: dto.role || 'team_member',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.transformMockData(newUser as typeof usersData[0]);
  }

  /**
   * Update user details
   */
  async updateUser(id: string, dto: UpdateUserDTO): Promise<User> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const updateData = camelToSnake(dto as unknown as Record<string, unknown>);

        const { data, error } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          return this.mapRowToUser(data);
        }
      } catch {
        // Fall through to mock
      }
    }

    await this.delay();
    const index = usersData.findIndex(u => u.id === id);
    if (index === -1) throw new Error(`User ${id} not found`);
    const updated = { ...usersData[index], ...dto, updatedAt: new Date().toISOString() };
    return this.transformMockData(updated as typeof usersData[0]);
  }

  /**
   * Get team members with specific role
   */
  async getUsersByRole(companyId: string, role: User['role']): Promise<User[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('company_id', companyId)
          .eq('role', role);

        if (!error && data) {
          return data.map(row => this.mapRowToUser(row));
        }
      } catch {
        // Fall through to mock
      }
    }

    await this.delay();
    return usersData
      .filter(u => u.companyId === companyId && u.role === role)
      .map(u => this.transformMockData(u));
  }

  /**
   * Get users with access to initiatives (operators and above)
   */
  async getOperators(companyId: string): Promise<User[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('company_id', companyId)
          .in('role', ['owner', 'operator']);

        if (!error && data) {
          return data.map(row => this.mapRowToUser(row));
        }
      } catch {
        // Fall through to mock
      }
    }

    await this.delay();
    const operatorRoles = ['owner', 'operator'];
    return usersData
      .filter(u => u.companyId === companyId && operatorRoles.includes(u.role as string))
      .map(u => this.transformMockData(u));
  }

  /**
   * Map a Supabase row (snake_case) to User type (camelCase)
   */
  private mapRowToUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      email: row.email as string,
      firstName: (row.first_name as string) || '',
      lastName: (row.last_name as string) || '',
      role: (row.role as User['role']) || 'team_member',
      marketingSignature: (row.marketing_signature as string) || undefined,
      stageOfBusiness: (row.stage_of_business as User['stageOfBusiness']) || undefined,
      isActive: row.is_active as boolean ?? true,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Transform mock JSON data to User type
   */
  private transformMockData(data: typeof usersData[0]): User {
    return {
      id: data.id,
      companyId: data.companyId,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: (data.role as User['role']) || 'team_member',
      marketingSignature: (data as any).marketingSignature || undefined,
      stageOfBusiness: (data as any).stageOfBusiness || undefined,
      isActive: (data as any).isActive ?? true,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const userService = new UserService();
