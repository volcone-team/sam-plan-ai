/**
 * Questionnaire Service
 * Manages the intake form and survey data
 * Note: In v1, questionnaire responses are stored in PlanningInput service
 * This service primarily manages the template and UI state
 */

export class QuestionnaireService {
  /**
   * Get questionnaire template
   */
  async getQuestionnaireTemplate(route: 'quickstart' | 'full' | 'foundation' = 'full'): Promise<any> {
    await this.delay();
    
    // Return structure for the questionnaire UI
    if (route === 'quickstart') {
      return {
        route: 'quickstart',
        title: 'Quick Start Planning',
        description: 'Get a rough plan in ~2 minutes',
        questions: [
          { id: 'q1', type: 'revenue_goal', label: 'What is your revenue goal?' },
          { id: 'q2', type: 'timeframe', label: 'When do you want to reach it?' },
          { id: 'q5', type: 'current_assets', label: 'What assets do you have?' },
        ],
      };
    }

    if (route === 'foundation') {
      return {
        route: 'foundation',
        title: 'Foundation Building',
        description: 'Pre-planning work - coming soon',
        questions: [],
      };
    }

    // Full route (all 7 questions)
    return {
      route: 'full',
      title: 'Full Planning Questionnaire',
      description: 'Comprehensive intake - ~15 minutes',
      questions: [
        {
          id: 'q1',
          type: 'revenue_goal',
          label: 'What is your revenue goal and timeframe?',
          required: true,
        },
        {
          id: 'q2',
          type: 'products',
          label: 'What products/services do you offer?',
          required: true,
        },
        {
          id: 'q3',
          type: 'wins',
          label: 'What has worked well for you?',
          required: false,
        },
        {
          id: 'q4',
          type: 'customer',
          label: 'Who is your ideal customer?',
          required: true,
        },
        {
          id: 'q5',
          type: 'current_assets',
          label: 'What current assets do you have? (email list, social, traffic, customers)',
          required: false,
        },
        {
          id: 'q6',
          type: 'budget_team',
          label: 'What is your monthly budget and team size?',
          required: false,
        },
        {
          id: 'q7',
          type: 'struggles',
          label: 'What has not worked?',
          required: false,
        },
      ],
    };
  }

  /**
   * Validate questionnaire completion
   */
  async validateQuestionnaireCompletion(
    route: 'quickstart' | 'full' | 'foundation'
  ): Promise<{ isComplete: boolean; missingQuestions: string[] }> {
    await this.delay();
    
    // In v1, this is validated by PlanningService
    // This is a placeholder for future use
    return {
      isComplete: true,
      missingQuestions: [],
    };
  }

  /**
   * Simulate network delay
   */
  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const questionnaireService = new QuestionnaireService();
