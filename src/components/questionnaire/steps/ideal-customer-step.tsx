import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { QuestionnaireData } from "../questionnaire-data";

interface IdealCustomerStepProps {
  data: QuestionnaireData;
  onChange: (updates: Partial<QuestionnaireData>) => void;
  errors: Record<string, string>;
}

export function IdealCustomerStep({ data, onChange, errors }: IdealCustomerStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ideal-customer" required>
          Describe Your Ideal Customer
        </Label>
        <Textarea
          id="ideal-customer"
          placeholder="e.g., Service-based business owners doing $500K–$3M who want to grow through marketing..."
          rows={3}
          value={data.idealCustomer}
          onChange={(e) => onChange({ idealCustomer: e.target.value })}
          error={!!errors.idealCustomer}
        />
        {errors.idealCustomer && (
          <p className="text-xs text-[hsl(var(--error))]">{errors.idealCustomer}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="industry">Industry</Label>
        <Input
          id="industry"
          placeholder="e.g., Coaching, SaaS, Professional Services"
          value={data.industry}
          onChange={(e) => onChange({ industry: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="business-type">Business Type</Label>
        <Input
          id="business-type"
          placeholder="e.g., B2B, B2C, Both"
          value={data.businessType}
          onChange={(e) => onChange({ businessType: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="biggest-problem">
          Biggest Problem You Solve
        </Label>
        <Textarea
          id="biggest-problem"
          placeholder="What is the #1 problem you solve for your customers?"
          rows={2}
          value={data.biggestProblem}
          onChange={(e) => onChange({ biggestProblem: e.target.value })}
        />
      </div>
    </div>
  );
}
