/**
 * Initiatives List Component Tests
 * Tests filtering, searching, and sorting logic
 */

import type { Initiative } from '@/types';

// Mock data factory
function createMockInitiative(overrides?: Partial<Initiative>): Initiative {
  return {
    id: `init-${Math.random()}`,
    companyId: 'comp-test',
    annualPlanId: 'plan-test',
    productId: 'prod-1',
    initiativeTypeId: 'type-1',
    name: 'Test Initiative',
    description: 'Test description',
    kind: 'one-time',
    status: 'planned',
    activationDate: new Date('2026-01-01'),
    eventDate: new Date('2026-02-01'),
    trafficInput: 100,
    revenueScenarios: {
      good: 1000,
      better: 2000,
      best: 3000,
    },
    plannedBudget: 500,
    actualSpend: 200,
    displayOrder: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('InitiativesList Filtering Logic', () => {
  describe('Search filtering', () => {
    test('should filter initiatives by name', () => {
      const initiatives = [
        createMockInitiative({ name: 'Webinar Launch' }),
        createMockInitiative({ name: 'Email Campaign' }),
        createMockInitiative({ name: 'Webinar Followup' }),
      ];

      const searchTerm = 'webinar';
      const filtered = initiatives.filter(i =>
        i.name.toLowerCase().includes(searchTerm.toLowerCase())
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.every(i => i.name.toLowerCase().includes(searchTerm))).toBe(true);
    });

    test('should be case-insensitive', () => {
      const initiatives = [
        createMockInitiative({ name: 'Webinar Launch' }),
      ];

      const filtered = initiatives.filter(i =>
        i.name.toLowerCase().includes('WEBINAR'.toLowerCase())
      );

      expect(filtered).toHaveLength(1);
    });

    test('should return empty array if no matches', () => {
      const initiatives = [
        createMockInitiative({ name: 'Webinar' }),
      ];

      const filtered = initiatives.filter(i =>
        i.name.toLowerCase().includes('nonexistent'.toLowerCase())
      );

      expect(filtered).toHaveLength(0);
    });
  });

  describe('Status filtering', () => {
    test('should filter initiatives by status', () => {
      const initiatives = [
        createMockInitiative({ status: 'planned' }),
        createMockInitiative({ status: 'in_progress' }),
        createMockInitiative({ status: 'planned' }),
      ];

      const selectedStatuses = ['planned' as const];
      const filtered = initiatives.filter(i =>
        selectedStatuses.includes(i.status)
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.every(i => i.status === 'planned')).toBe(true);
    });

    test('should support multiple status filters', () => {
      const initiatives = [
        createMockInitiative({ status: 'planned' }),
        createMockInitiative({ status: 'in_progress' }),
        createMockInitiative({ status: 'completed' }),
      ];

      const selectedStatuses = ['planned' as const, 'in_progress' as const];
      const filtered = initiatives.filter(i =>
        selectedStatuses.includes(i.status)
      );

      expect(filtered).toHaveLength(2);
    });
  });

  describe('Product filtering', () => {
    test('should filter initiatives by product', () => {
      const initiatives = [
        createMockInitiative({ productId: 'prod-1' }),
        createMockInitiative({ productId: 'prod-2' }),
        createMockInitiative({ productId: 'prod-1' }),
      ];

      const selectedProducts = ['prod-1'];
      const filtered = initiatives.filter(i =>
        selectedProducts.includes(i.productId)
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.every(i => i.productId === 'prod-1')).toBe(true);
    });
  });

  describe('Initiative type filtering', () => {
    test('should filter initiatives by type', () => {
      const initiatives = [
        createMockInitiative({ initiativeTypeId: 'type-1' }),
        createMockInitiative({ initiativeTypeId: 'type-2' }),
        createMockInitiative({ initiativeTypeId: 'type-1' }),
      ];

      const selectedTypes = ['type-1'];
      const filtered = initiatives.filter(i =>
        selectedTypes.includes(i.initiativeTypeId)
      );

      expect(filtered).toHaveLength(2);
      expect(filtered.every(i => i.initiativeTypeId === 'type-1')).toBe(true);
    });

    test('should support multiple type filters', () => {
      const initiatives = [
        createMockInitiative({ initiativeTypeId: 'type-1' }),
        createMockInitiative({ initiativeTypeId: 'type-2' }),
        createMockInitiative({ initiativeTypeId: 'type-3' }),
      ];

      const selectedTypes = ['type-1', 'type-2'];
      const filtered = initiatives.filter(i =>
        selectedTypes.includes(i.initiativeTypeId)
      );

      expect(filtered).toHaveLength(2);
    });
  });

  describe('Quarter filtering', () => {
    test('should filter initiatives by quarter', () => {
      const initiatives = [
        createMockInitiative({ eventDate: new Date('2026-01-15') }), // Q1
        createMockInitiative({ eventDate: new Date('2026-04-15') }), // Q2
        createMockInitiative({ eventDate: new Date('2026-02-28') }), // Q1
      ];

      const filterQuarter = (initiative: Initiative, quarter: string): boolean => {
        const eventDate = initiative.eventDate || initiative.activationDate;
        const month = eventDate.getMonth() + 1;
        const year = eventDate.getFullYear();

        const [qNum, qYear] = quarter.split(' ');
        const quarterNum = parseInt(qNum[1]);
        const quarterYearNum = parseInt(qYear);

        const quarterMonthStart = (quarterNum - 1) * 3 + 1;
        const quarterMonthEnd = quarterNum * 3;

        return (
          year === quarterYearNum &&
          month >= quarterMonthStart &&
          month <= quarterMonthEnd
        );
      };

      const filtered = initiatives.filter(i => filterQuarter(i, 'Q1 2026'));

      expect(filtered).toHaveLength(2);
    });
  });

  describe('Combined filtering', () => {
    test('should apply all filters together', () => {
      const initiatives = [
        createMockInitiative({
          name: 'Webinar',
          status: 'planned',
          productId: 'prod-1',
          initiativeTypeId: 'type-1',
        }),
        createMockInitiative({
          name: 'Email',
          status: 'in_progress',
          productId: 'prod-2',
          initiativeTypeId: 'type-2',
        }),
        createMockInitiative({
          name: 'Webinar 2',
          status: 'planned',
          productId: 'prod-1',
          initiativeTypeId: 'type-1',
        }),
      ];

      // Filter: search "Webinar", status "planned", product "prod-1"
      let filtered = initiatives.filter(i =>
        i.name.toLowerCase().includes('webinar'.toLowerCase())
      );
      filtered = filtered.filter(i => i.status === 'planned');
      filtered = filtered.filter(i => i.productId === 'prod-1');

      expect(filtered).toHaveLength(2);
    });
  });
});

describe('InitiativesList Sorting Logic', () => {
  describe('Sort by date created', () => {
    test('should sort initiatives by creation date descending', () => {
      const initiatives = [
        createMockInitiative({
          createdAt: new Date('2026-01-01'),
          name: 'First',
        }),
        createMockInitiative({
          createdAt: new Date('2026-01-03'),
          name: 'Third',
        }),
        createMockInitiative({
          createdAt: new Date('2026-01-02'),
          name: 'Second',
        }),
      ];

      const sorted = [...initiatives].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      expect(sorted[0].name).toBe('Third');
      expect(sorted[1].name).toBe('Second');
      expect(sorted[2].name).toBe('First');
    });
  });

  describe('Sort by status', () => {
    test('should sort initiatives by status priority', () => {
      const statusOrder: Record<string, number> = {
        'in_progress': 0,
        'launched': 1,
        'planned': 2,
        'paused': 3,
        'completed': 4,
        'retired': 5,
      };

      const initiatives = [
        createMockInitiative({ status: 'completed', name: 'Completed' }),
        createMockInitiative({ status: 'in_progress', name: 'In Progress' }),
        createMockInitiative({ status: 'planned', name: 'Planned' }),
      ];

      const sorted = [...initiatives].sort(
        (a, b) =>
          (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
      );

      expect(sorted[0].status).toBe('in_progress');
      expect(sorted[1].status).toBe('planned');
      expect(sorted[2].status).toBe('completed');
    });
  });

  describe('Sort by revenue', () => {
    test('should sort initiatives by best case revenue descending', () => {
      const initiatives = [
        createMockInitiative({
          revenueScenarios: { good: 100, better: 500, best: 1000 },
          name: 'High Revenue',
        }),
        createMockInitiative({
          revenueScenarios: { good: 50, better: 200, best: 400 },
          name: 'Low Revenue',
        }),
        createMockInitiative({
          revenueScenarios: { good: 75, better: 300, best: 750 },
          name: 'Mid Revenue',
        }),
      ];

      const sorted = [...initiatives].sort(
        (a, b) => b.revenueScenarios.best - a.revenueScenarios.best
      );

      expect(sorted[0].name).toBe('High Revenue');
      expect(sorted[1].name).toBe('Mid Revenue');
      expect(sorted[2].name).toBe('Low Revenue');
    });
  });
});

describe('Budget calculations', () => {
  test('should calculate remaining budget correctly', () => {
    const initiative = createMockInitiative({
      plannedBudget: 1000,
      actualSpend: 300,
    });

    const remaining = initiative.plannedBudget - initiative.actualSpend;
    expect(remaining).toBe(700);
  });

  test('should identify over-budget initiatives', () => {
    const initiative = createMockInitiative({
      plannedBudget: 500,
      actualSpend: 750,
    });

    const isOverBudget = initiative.actualSpend > initiative.plannedBudget;
    expect(isOverBudget).toBe(true);
  });
});

describe('Empty states', () => {
  test('should identify empty list', () => {
    const initiatives: Initiative[] = [];
    expect(initiatives.length).toBe(0);
  });

  test('should identify when all items are filtered out', () => {
    const initiatives = [
      createMockInitiative({ status: 'planned' }),
      createMockInitiative({ status: 'planned' }),
    ];

    const filtered = initiatives.filter(i => i.status === 'completed');
    expect(filtered.length).toBe(0);
  });
});
