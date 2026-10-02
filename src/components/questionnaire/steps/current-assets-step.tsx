import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import type { QuestionnaireData } from "../questionnaire-data";

interface CurrentAssetsStepProps {
  data: QuestionnaireData;
  onChange: (updates: Partial<QuestionnaireData>) => void;
  errors: Record<string, string>;
}

export function CurrentAssetsStep({ data, onChange }: CurrentAssetsStepProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-md)] bg-[hsl(var(--info-background))] border border-[hsl(var(--info-border))] p-3 text-sm text-[hsl(var(--foreground-muted))]">
        Your existing assets help us generate more accurate revenue projections and realistic initiative recommendations.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email-list-size">Email List Size</Label>
          <NumberInput
            id="email-list-size"
            placeholder="0"
            value={data.emailListSize}
            onValueChange={(emailListSize) => onChange({ emailListSize })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="monthly-visitors">Monthly Website Visitors</Label>
          <NumberInput
            id="monthly-visitors"
            placeholder="0"
            value={data.monthlyWebsiteVisitors}
            onValueChange={(monthlyWebsiteVisitors) => onChange({ monthlyWebsiteVisitors })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="social-following">Social Following</Label>
          <NumberInput
            id="social-following"
            placeholder="0"
            value={data.socialFollowing}
            onValueChange={(socialFollowing) => onChange({ socialFollowing })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="existing-customers">Existing Customers</Label>
          <NumberInput
            id="existing-customers"
            placeholder="0"
            value={data.existingCustomers}
            onValueChange={(existingCustomers) => onChange({ existingCustomers })}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="monthly-leads">Monthly Leads</Label>
          <NumberInput
            id="monthly-leads"
            placeholder="0"
            value={data.monthlyLeads}
            onValueChange={(monthlyLeads) => onChange({ monthlyLeads })}
          />
        </div>
      </div>
    </div>
  );
}
