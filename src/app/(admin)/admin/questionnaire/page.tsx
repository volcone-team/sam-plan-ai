import { QuestionnaireManagement } from "@/components/admin/questionnaire-management";

export const metadata = {
  title: "Questionnaire Management | Admin | SAM Flow AI",
};

export default function AdminQuestionnairePage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Questionnaire Management
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Configure onboarding and intake questions
        </p>
      </div>
      <QuestionnaireManagement />
    </div>
  );
}
