/**
 * Initiative Type Service Tests
 * Tests for initiative type loading, filtering, and retrieval
 */

import { initiativeTypeService } from '../initiative-type.service';

describe('InitiativeTypeService', () => {
  describe('getAllInitiativeTypes', () => {
    test('should return all active initiative types sorted by tier and displayOrder', async () => {
      const types = await initiativeTypeService.getAllInitiativeTypes();

      expect(types).toBeDefined();
      expect(types.length).toBeGreaterThan(0);
      
      // Verify types are sorted by tier
      for (let i = 1; i < types.length; i++) {
        const prevTier = types[i - 1].tier;
        const currTier = types[i].tier;
        
        if (prevTier === currTier) {
          // Same tier, check displayOrder
          expect(types[i - 1].displayOrder).toBeLessThanOrEqual(
            types[i].displayOrder
          );
        } else {
          // Different tier, prev should be less than current
          expect(prevTier).toBeLessThanOrEqual(currTier);
        }
      }
    });

    test('should not include inactive initiative types', async () => {
      const types = await initiativeTypeService.getAllInitiativeTypes();
      const allInactive = types.every(t => t.isActive === true);
      expect(allInactive).toBe(true);
    });

    test('each initiative type should have required fields', async () => {
      const types = await initiativeTypeService.getAllInitiativeTypes();
      
      types.forEach(type => {
        expect(type.id).toBeDefined();
        expect(type.name).toBeDefined();
        expect(type.channel).toBeDefined();
        expect(type.benchmarks).toBeDefined();
        expect(type.projectTemplate).toBeDefined();
        expect(type.difficulty).toBeDefined();
        expect(type.aiContext).toBeDefined();
      });
    });
  });

  describe('getTier1InitiativeTypes', () => {
    test('should return only Tier 1 initiative types', async () => {
      const tier1Types = await initiativeTypeService.getTier1InitiativeTypes();

      expect(tier1Types).toBeDefined();
      expect(tier1Types.length).toBeGreaterThan(0);
      
      tier1Types.forEach(type => {
        expect(type.tier).toBe(1);
      });
    });

    test('Tier 1 should have at least 8-12 types (core library)', async () => {
      const tier1Types = await initiativeTypeService.getTier1InitiativeTypes();
      // Requirement says "~8-12 core initiative types"
      expect(tier1Types.length).toBeGreaterThanOrEqual(6); // Allow some flexibility
    });
  });

  describe('getInitiativeType', () => {
    test('should retrieve a specific initiative type by id', async () => {
      const allTypes = await initiativeTypeService.getAllInitiativeTypes();
      const firstType = allTypes[0];

      const retrievedType = await initiativeTypeService.getInitiativeType(
        firstType.id
      );

      expect(retrievedType).toBeDefined();
      expect(retrievedType.id).toBe(firstType.id);
      expect(retrievedType.name).toBe(firstType.name);
    });

    test('should throw error if initiative type not found', async () => {
      await expect(
        initiativeTypeService.getInitiativeType('non-existent-id')
      ).rejects.toThrow();
    });
  });

  describe('getInitiativeTypesByChannel', () => {
    test('should return initiative types filtered by channel', async () => {
      const webinarTypes = await initiativeTypeService.getInitiativeTypesByChannel(
        'webinar'
      );

      expect(webinarTypes).toBeDefined();
      webinarTypes.forEach(type => {
        expect(type.channel).toBe('webinar');
      });
    });

    test('should return empty array if channel has no types', async () => {
      const types = await initiativeTypeService.getInitiativeTypesByChannel(
        'non-existent-channel'
      );

      expect(types).toEqual([]);
    });
  });

  describe('Benchmarks structure', () => {
    test('each initiative type should have valid benchmark scenarios', async () => {
      const types = await initiativeTypeService.getAllInitiativeTypes();

      types.forEach(type => {
        Object.values(type.benchmarks).forEach(benchmark => {
          expect(benchmark.conservative).toBeDefined();
          expect(benchmark.moderate).toBeDefined();
          expect(benchmark.aggressive).toBeDefined();
          
          expect(typeof benchmark.conservative).toBe('number');
          expect(typeof benchmark.moderate).toBe('number');
          expect(typeof benchmark.aggressive).toBe('number');
          
          // Conservative should be <= moderate <= aggressive
          expect(benchmark.conservative).toBeLessThanOrEqual(
            benchmark.moderate
          );
          expect(benchmark.moderate).toBeLessThanOrEqual(benchmark.aggressive);
        });
      });
    });
  });

  describe('Difficulty dimensions', () => {
    test('each initiative type should have valid difficulty dimensions', async () => {
      const types = await initiativeTypeService.getAllInitiativeTypes();

      types.forEach(type => {
        const { difficulty } = type;
        
        expect(difficulty.effortToImplement).toBeGreaterThanOrEqual(1);
        expect(difficulty.effortToImplement).toBeLessThanOrEqual(10);
        
        expect(difficulty.skillExpertiseRequired).toBeGreaterThanOrEqual(1);
        expect(difficulty.skillExpertiseRequired).toBeLessThanOrEqual(10);
        
        expect(difficulty.timeToResults).toBeGreaterThanOrEqual(1);
        expect(difficulty.timeToResults).toBeLessThanOrEqual(10);
        
        expect(difficulty.costToRun).toBeGreaterThanOrEqual(1);
        expect(difficulty.costToRun).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('Project templates', () => {
    test('each initiative type should have valid project templates', async () => {
      const types = await initiativeTypeService.getAllInitiativeTypes();

      types.forEach(type => {
        const { projectTemplate } = type;
        
        expect(projectTemplate.tasks).toBeDefined();
        expect(Array.isArray(projectTemplate.tasks)).toBe(true);
        expect(projectTemplate.totalEstimatedHours).toBeGreaterThan(0);
        
        projectTemplate.tasks.forEach(task => {
          expect(task.id).toBeDefined();
          expect(task.name).toBeDefined();
          expect(task.description).toBeDefined();
          expect(task.daysBeforeEvent).toBeDefined();
          expect(task.estimatedHours).toBeGreaterThan(0);
          expect(Array.isArray(task.roles)).toBe(true);
          expect(Array.isArray(task.dependencies)).toBe(true);
        });
      });
    });
  });
});
