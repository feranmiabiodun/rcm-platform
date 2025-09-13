import heroImage from '@/assets/hero-image.png';
import React, { useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRCM } from '@/contexts/RCMContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CATEGORIES } from '@/data/categories';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StageOptions } from './StageOptions';

interface PersistentPanelProps {
  className?: string;
}

export const PersistentPanel: React.FC<PersistentPanelProps> = ({ className }) => {
  const { 
    selectedCategoryId, 
    isDarkMode, 
    setIsDarkMode
  } = useRCM();
  
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const titleRef = useRef<HTMLHeadingElement>(null);

  const selectedCategory = CATEGORIES.find(cat => cat.id === selectedCategoryId);

  // Focus management for accessibility
  useEffect(() => {
    if (selectedCategoryId && titleRef.current) {
      titleRef.current.focus();
    }
  }, [selectedCategoryId]);

  if (!selectedCategory) {
    return (
      <div className={cn(
        "flex items-center justify-center text-center p-8",
        isDesktop ? "fixed left-[380px] top-1/2 transform -translate-y-1/2 w-[640px] h-[600px]" : "w-full",
        className
      )}>
        <Card className="w-full max-w-md bg-brand-panel border-border shadow-panel overflow-hidden">
          <div className="relative h-48 overflow-hidden">
            <img 
              src={heroImage} 
              alt="AI-Native RCM Platform" 
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-primary/20" />
          </div>
          <CardContent className="p-8">
            <div className="space-y-4">
              <div className="w-16 h-16 mx-auto bg-gradient-primary rounded-full flex items-center justify-center -mt-16 relative z-10 border-4 border-white shadow-lg">
                <Search className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-brand-charcoal mb-2">
                  AI-Native RCM
                </h3>
                <p className="text-brand-muted-text text-sm leading-relaxed">
                  Select a category from the left navigation to begin your revenue cycle management workflow. 
                  Our AI-powered platform streamlines every step from eligibility to reconciliation.
                </p>
              </div>
              <div className="pt-4">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="text-brand-accent border-brand-accent hover:bg-brand-accent hover:text-white"
                >
                  View Quick Start Guide →
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-brand-panel border border-border shadow-panel rounded-lg",
        isDesktop 
          ? "fixed left-[380px] top-1/2 transform -translate-y-1/2 w-[640px] max-h-[80vh] overflow-hidden"  
          : "w-full mx-4 my-4",
        className
      )}
      role="region"
      aria-labelledby="overlay-title"
    >
      {/* Header */}
      <CardHeader className="pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 bg-white rounded-sm" />
          </div>
          <div>
            <h2 
              ref={titleRef}
              id="overlay-title"
              className="text-lg font-semibold text-brand-charcoal"
              tabIndex={-1}
            >
              {selectedCategory.label}
            </h2>
            <p className="text-sm text-brand-muted-text">
              {selectedCategory.subtitle}
            </p>
          </div>
        </div>
      </CardHeader>

      {/* Body */}
      <CardContent className="p-6 max-h-[60vh] overflow-y-auto">
        <StageOptions categoryId={selectedCategory.id} />
      </CardContent>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-border bg-brand-left-column/50">
        <div className="flex items-center justify-between text-xs text-brand-muted-text">
          <div className="flex items-center gap-4">
            {/* Removed Last sync and DevMode controls */}
          </div>
          
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-brand-accent">
            Quick Start Guide →
          </Button>
        </div>
      </div>
    </div>
  );
};
