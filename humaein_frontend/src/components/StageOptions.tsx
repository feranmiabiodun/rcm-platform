import React from "react";
import { ChevronDown, ChevronRight, Upload, FileText, Database, Send, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRCM } from "@/contexts/RCMContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PatientDetailsForm } from "./forms/PatientDetailsForm";
import { PatientDataUpload } from "./forms/PatientDataUpload";
import { StageActionForm } from "./forms/StageActionForm";

interface StageOptionsProps {
  categoryId: string;
}

interface OptionConfig {
  id: string;
  title: string;
  description: string;
  // lucide-react icons are SVG components — type them explicitly to avoid `any`.
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  type: "manual" | "upload" | "action";
}

const getOptionsForCategory = (categoryId: string): OptionConfig[] => {
  const baseOptions: OptionConfig[] = [
    {
      id: "enter-patient-details",
      title: "Enter Patient Details",
      description: "Manually enter minimal patient identifiers",
      icon: FileText,
      type: "manual",
    },
    {
      id: "upload-patient-data",
      title: "Upload Patient Data",
      description: "Upload CSV or JSON files with patient data",
      icon: Upload,
      type: "upload",
    },
  ];

  const stageActions: Record<string, OptionConfig[]> = {
    "check-eligibility": [
      {
        id: "run-db-query",
        title: "Run DB Query",
        description: "Query existing eligibility database",
        icon: Database,
        type: "action",
      },
    ],
    "clinical-documentation": [
      {
        id: "document-tagging",
        title: "Document Tagging",
        description: "Tag and categorize clinical documents",
        icon: FileText,
        type: "action",
      },
    ],
    "medical-coding": [
      {
        id: "auto-code",
        title: "Auto-Code from Notes",
        description: "Extract ICD/CPT codes from clinical notes",
        icon: Send,
        type: "action",
      },
    ],
    "claims-scrubbing": [
      {
        id: "rule-analysis",
        title: "Rule Analysis",
        description: "Run comprehensive rule-based validation",
        icon: AlertCircle,
        type: "action",
      },
    ],
    "claims-submission": [
      {
        id: "batch-submit",
        title: "Batch Submit",
        description: "Submit multiple claims simultaneously",
        icon: Send,
        type: "action",
      },
    ],
    "denial-management": [
      {
        id: "draft-appeal",
        title: "Draft Appeal",
        description: "Generate appeal documentation",
        icon: FileText,
        type: "action",
      },
    ],
    remittance: [
      {
        id: "process-edi",
        title: "Process EDI 835",
        description: "Parse electronic remittance advice",
        icon: Database,
        type: "action",
      },
    ],
    resubmit: [
      {
        id: "correct-resubmit",
        title: "Correct & Resubmit",
        description: "Apply corrections and resubmit claim",
        icon: Send,
        type: "action",
      },
    ],
    reconciliation: [
      {
        id: "auto-match",
        title: "Auto-Match Payments",
        description: "Automatically match payments to claims",
        icon: Database,
        type: "action",
      },
    ],
  };

  return [...baseOptions, ...(stageActions[categoryId] || [])];
};

export const StageOptions: React.FC<StageOptionsProps> = ({ categoryId }) => {
  const { expandedOptionId, setExpandedOptionId } = useRCM();

  const options = getOptionsForCategory(categoryId);

  const handleToggleOption = (optionId: string): void => {
    setExpandedOptionId(expandedOptionId === optionId ? null : optionId);
  };

  const renderOptionContent = (option: OptionConfig): React.ReactNode => {
    switch (option.type) {
      case "manual":
        return <PatientDetailsForm categoryId={categoryId} optionId={option.id} />;
      case "upload":
        return <PatientDataUpload categoryId={categoryId} optionId={option.id} />;
      case "action":
        return <StageActionForm categoryId={categoryId} optionId={option.id} actionType={option.id} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3">
      {options.map((option) => {
        const Icon = option.icon;
        const isExpanded = expandedOptionId === option.id;

        return (
          <Card key={option.id} className="bg-brand-card border-border">
            <Collapsible open={isExpanded} onOpenChange={() => handleToggleOption(option.id)}>
              <CollapsibleTrigger asChild>
                <CardHeader
                  className="cursor-pointer hover:bg-brand-left-column/50 transition-colors p-4"
                  role="button"
                  aria-expanded={isExpanded}
                  tabIndex={0}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center",
                          isExpanded ? "bg-brand-accent text-white" : "bg-brand-left-column text-brand-accent"
                        )}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <CardTitle className="text-sm font-medium text-brand-charcoal">{option.title}</CardTitle>
                        <p className="text-xs text-brand-muted-text mt-1">{option.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="w-4 h-4 text-brand-muted-text" /> : <ChevronRight className="w-4 h-4 text-brand-muted-text" />}
                    </div>
                  </div>
                </CardHeader>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <CardContent className="px-4 pb-4">
                  <div className="border-t border-border pt-4">{renderOptionContent(option)}</div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}
    </div>
  );
};
