import { Input } from "@/components/ui/input";
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
          <Input
            id="email-list-size"
            type="number"
            placeholder="0"
            value={data.emailListSize ?? ""}
            onChange={(e) =>
              onChange({ emailListSize: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="monthly-visitors">Monthly Website Visitors</Label>
          <Input
            id="monthly-visitors"
            type="number"
            placeholder="0"
            value={data.monthlyWebsiteVisitors ?? ""}
            onChange={(e) =>
              onChange({ monthlyWebsiteVisitors: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="social-following">Social Following</Label>
          <Input
            id="social-following"
            type="number"
            placeholder="0"
            value={data.socialFollowing ?? ""}
            onChange={(e) =>
              onChange({ socialFollowing: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="existing-customers">Existing Customers</Label>
          <Input
            id="existing-customers"
            type="number"
            placeholder="0"
            value={data.existingCustomers ?? ""}
            onChange={(e) =>
              onChange({ existingCustomers: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="monthly-leads">Monthly Leads</Label>
          <Input
            id="monthly-leads"
            type="number"
            placeholder="0"
            value={data.monthlyLeads ?? ""}
            onChange={(e) =>
              onChange({ monthlyLeads: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>
      </div>
    </div>
  );
}
