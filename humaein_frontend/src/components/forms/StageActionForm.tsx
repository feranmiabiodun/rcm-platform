import React, { useState } from 'react';
import { Database, FileText, Send, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ComboSearchInput } from '../ComboSearchInput';

interface StageActionFormProps {
  categoryId: string;
  optionId: string;
  actionType: string;
}

const getActionConfig = (actionType: string) => {
  const configs: Record<
    string,
    {
      title: string;
      description: string;
      icon: React.ElementType;
      fields: Array<{ name: string; label: string; type: string; required?: boolean; options?: string[] }>;
    }
  > = {
    'run-db-query': {
      title: 'Database Query',
      description: 'Query eligibility database directly',
      icon: Database,
      fields: [
        { name: 'collection', label: 'Collection', type: 'select', required: true, options: ['eligibility', 'members', 'policies'] },
        { name: 'query', label: 'Query (JSON)', type: 'textarea', required: true }
      ]
    },
    'document-tagging': {
      title: 'Document Tagging',
      description: 'Categorize and tag clinical documents',
      icon: FileText,
      fields: [
        { name: 'documentId', label: 'Document ID', type: 'text', required: true },
        { name: 'tags', label: 'Tags (comma-separated)', type: 'text' },
        { name: 'category', label: 'Document Category', type: 'select', options: ['lab-results', 'imaging', 'notes', 'referral', 'prescription'] }
      ]
    },
    'auto-code': {
      title: 'Auto-Code from Notes',
      description: 'Extract ICD/CPT codes from clinical documentation',
      icon: Send,
      fields: [
        { name: 'notes', label: 'Clinical Notes', type: 'textarea', required: true },
        { name: 'codeTypes', label: 'Code Types', type: 'select', options: ['ICD-10', 'CPT', 'Both'] },
        { name: 'specialtyContext', label: 'Specialty Context', type: 'select', options: ['general', 'cardiology', 'orthopedics', 'neurology', 'oncology'] }
      ]
    },
    'rule-analysis': {
      title: 'Claims Rule Analysis',
      description: 'Run comprehensive validation rules',
      icon: AlertCircle,
      fields: [
        { name: 'ruleSet', label: 'Rule Set', type: 'select', required: true, options: ['standard', 'payer-specific', 'comprehensive'] },
        { name: 'severity', label: 'Minimum Severity', type: 'select', options: ['info', 'warning', 'error'] }
      ]
    },
    'batch-submit': {
      title: 'Batch Claims Submission',
      description: 'Submit multiple claims simultaneously',
      icon: Send,
      fields: [
        { name: 'batchSize', label: 'Batch Size', type: 'number' },
        { name: 'submissionType', label: 'Submission Type', type: 'select', options: ['electronic', 'paper', 'clearinghouse'] },
        { name: 'priority', label: 'Priority', type: 'select', options: ['normal', 'urgent', 'stat'] }
      ]
    },
    'draft-appeal': {
      title: 'Draft Appeal Letter',
      description: 'Generate appeal documentation for denials',
      icon: FileText,
      fields: [
        { name: 'denialId', label: 'Denial ID', type: 'text', required: true },
        { name: 'appealText', label: 'Appeal Justification', type: 'textarea', required: true },
        { name: 'appealType', label: 'Appeal Type', type: 'select', options: ['first-level', 'second-level', 'external-review'] }
      ]
    },
    'process-edi': {
      title: 'Process EDI 835',
      description: 'Parse electronic remittance advice files',
      icon: Database,
      fields: [
        { name: 'ediContent', label: 'EDI 835 Content', type: 'textarea', required: true },
        { name: 'validateFormat', label: 'Validate Format', type: 'select', options: ['strict', 'lenient'] }
      ]
    },
    'correct-resubmit': {
      title: 'Correct & Resubmit Claims',
      description: 'Apply corrections and resubmit rejected claims',
      icon: Send,
      fields: [
        { name: 'corrections', label: 'Corrections Applied', type: 'textarea', required: true },
        { name: 'resubmissionReason', label: 'Resubmission Reason', type: 'select', options: ['corrected-data', 'additional-info', 'payer-error'] }
      ]
    },
    'auto-match': {
      title: 'Auto-Match Payments',
      description: 'Automatically reconcile payments with claims',
      icon: Database,
      fields: [
        { name: 'matchCriteria', label: 'Match Criteria', type: 'select', options: ['exact', 'fuzzy', 'manual-review'] },
        { name: 'dateRange', label: 'Date Range (days)', type: 'number' }
      ]
    }
  };

  return configs[actionType] || {
    title: 'Stage Action',
    description: 'Perform stage-specific action',
    icon: AlertCircle,
    fields: []
  };
};

export const StageActionForm: React.FC<StageActionFormProps> = ({ categoryId, optionId, actionType }) => {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const config = getActionConfig(actionType);
  const Icon = config.icon;

  const handleInputChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    // Clear validation errors when user types
    if (validationErrors.length > 0) {
      setValidationErrors([]);
    }
  };

  const validateForm = () => {
    const errors: string[] = [];
    const requiredFields = config.fields.filter(f => f.required);
    
    requiredFields.forEach(field => {
      if (!formData[field.name]?.trim()) {
        errors.push(`${field.label} is required`);
      }
    });
    
    // Specific validation for JSON fields
    if (formData.query) {
      try {
        JSON.parse(formData.query);
      } catch {
        errors.push('Query must be valid JSON');
      }
    }
    
    return errors;
  };

  const handleSubmit = async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      console.log(`Submitting ${actionType} action:`, formData);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Header */}
      <Card className="bg-brand-left-column/30 border-brand-accent/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-brand-charcoal flex items-center gap-2">
            <Icon className="w-4 h-4" />
            {config.title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-brand-muted-text">
            {config.description}
          </p>
        </CardContent>
      </Card>

      {/* Form Fields */}
      <div className="space-y-4">
        {config.fields.map((field) => (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={field.name} className="text-sm font-medium text-brand-charcoal">
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            
            {field.type === 'select' ? (
              <Select 
                value={formData[field.name] || ''} 
                onValueChange={(value) => handleInputChange(field.name, value)}
              >
                <SelectTrigger className="bg-brand-panel">
                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
                </SelectTrigger>
                <SelectContent>
                  {field.options?.map(option => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === 'textarea' ? (
              <Textarea
                id={field.name}
                value={formData[field.name] || ''}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                className="bg-brand-panel min-h-[100px]"
                rows={4}
              />
            ) : field.type === 'number' ? (
              <Input
                id={field.name}
                type="number"
                value={formData[field.name] || ''}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                className="bg-brand-panel"
              />
            ) : (
              <Input
                id={field.name}
                type="text"
                value={formData[field.name] || ''}
                onChange={(e) => handleInputChange(field.name, e.target.value)}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                className="bg-brand-panel"
              />
            )}
          </div>
        ))}
      </div>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Alert className="border-destructive bg-destructive/10">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ul className="text-sm space-y-1">
              {validationErrors.map((error, index) => (
                <li key={index} className="text-destructive">• {error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Submit Button */}
      <Button 
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full bg-gradient-primary hover:bg-brand-accent-2 text-white"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Processing...
          </>
        ) : (
          `Execute ${config.title}`
        )}
      </Button>
    </div>
  );
};
