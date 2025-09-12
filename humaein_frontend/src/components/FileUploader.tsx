import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FileUploaderProps {
  accept?: string;
  maxSize?: number; // in MB
  multiple?: boolean;
  onFilesChange?: (files: File[]) => void;
  className?: string;
  disabled?: boolean;
}

interface FileWithPreview {
  file: File;
  id: string;
  preview?: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress?: number;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  accept = '.csv,.json,.pdf,.jpg,.jpeg,.png,.docx,.dcm',
  maxSize = 50,
  multiple = false,
  onFilesChange,
  className,
  disabled = false
}) => {
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // validateFile depends on accept and maxSize -> wrap in useCallback so its identity is stable
  const validateFile = useCallback((file: File) => {
    const errors: string[] = [];

    // Size validation
    if (file.size > maxSize * 1024 * 1024) {
      errors.push(`File size exceeds ${maxSize}MB limit`);
    }

    // Type validation
    const allowedTypes = accept.split(',').map(t => t.trim());
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!allowedTypes.includes(fileExtension)) {
      errors.push(`File type not supported. Allowed: ${accept}`);
    }

    return errors;
  }, [accept, maxSize]);

  const handleFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const validFiles: FileWithPreview[] = [];
    const errors: string[] = [];

    fileArray.forEach(file => {
      const validationErrors = validateFile(file);
      if (validationErrors.length === 0) {
        validFiles.push({
          file,
          id: Date.now().toString() + Math.random().toString(36),
          status: 'pending'
        });
      } else {
        errors.push(`${file.name}: ${validationErrors.join(', ')}`);
      }
    });

    if (multiple) {
      setFiles(prev => [...prev, ...validFiles]);
    } else {
      setFiles(validFiles.slice(0, 1));
    }

    if (errors.length > 0) {
      // You might want to show these errors in a toast or alert
      console.warn('File validation errors:', errors);
    }

    onFilesChange?.(validFiles.map(f => f.file));
  }, [multiple, onFilesChange, validateFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (disabled) return;

    const droppedFiles = e.dataTransfer.files;
    handleFiles(droppedFiles);
  }, [disabled, handleFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  const removeFile = (id: string) => {
    setFiles(prev => {
      const updated = prev.filter(f => f.id !== id);
      onFilesChange?.(updated.map(f => f.file));
      return updated;
    });
  };

  const needsConfirmation = files.some(f => f.file.size > 50 * 1024 * 1024);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop Zone */}
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-all",
          "hover:border-brand-accent hover:bg-brand-left-column/50",
          isDragOver && "border-brand-accent bg-brand-left-column/50",
          disabled && "opacity-50 cursor-not-allowed",
          "border-border bg-brand-card"
        )}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
      >
        <Upload className="mx-auto h-8 w-8 text-brand-muted-text mb-2" />
        <p className="text-sm font-medium text-brand-charcoal mb-1">
          Drop files here or click to browse
        </p>
        <p className="text-xs text-brand-muted-text mb-4">
          Supports: {accept} • Max {maxSize}MB per file
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          Choose Files
        </Button>
        <input
          id="file-input"
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileInput}
          className="hidden"
          disabled={disabled}
        />
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((fileItem) => (
            <div
              key={fileItem.id}
              className="flex items-center gap-3 p-3 bg-brand-card rounded-lg border border-border"
            >
              <FileText className="h-4 w-4 text-brand-accent flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-charcoal truncate">
                  {fileItem.file.name}
                </p>
                <p className="text-xs text-brand-muted-text">
                  {formatFileSize(fileItem.file.size)}
                </p>
                {fileItem.status === 'uploading' && fileItem.progress !== undefined && (
                  <Progress value={fileItem.progress} className="mt-1 h-1" />
                )}
              </div>
              <div className="flex items-center gap-2">
                {fileItem.status === 'success' && (
                  <Check className="h-4 w-4 text-green-500" />
                )}
                {fileItem.status === 'error' && (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(fileItem.id)}
                  className="h-6 w-6 p-0 hover:bg-destructive/10"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Large File Warning */}
      {needsConfirmation && (
        <Alert className="border-brand-gold bg-brand-gold/10">
          <AlertTriangle className="h-4 w-4 text-brand-gold" />
          <AlertDescription className="text-brand-charcoal">
            Some files are larger than 50MB. Processing may take longer. 
            Please confirm you want to proceed with these large files.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};
