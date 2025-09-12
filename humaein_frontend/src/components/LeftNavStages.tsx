import React, { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useRCM } from '@/contexts/RCMContext';
import { CATEGORIES } from '@/data/categories';

interface LeftNavStagesProps {
  className?: string;
}

export const LeftNavStages: React.FC<LeftNavStagesProps> = ({ className }) => {
  const { selectedCategoryId, setSelectedCategoryId } = useRCM();

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return; // Don't interfere with form inputs
      }

      const currentIndex = selectedCategoryId 
        ? CATEGORIES.findIndex(cat => cat.id === selectedCategoryId)
        : -1;

      let newIndex = currentIndex;

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          newIndex = currentIndex > 0 ? currentIndex - 1 : CATEGORIES.length - 1;
          break;
        case 'ArrowDown':
          e.preventDefault();
          newIndex = currentIndex < CATEGORIES.length - 1 ? currentIndex + 1 : 0;
          break;
        case 'Enter':
        case ' ':
          if (currentIndex >= 0) {
            e.preventDefault();
            // Focus will be moved to panel via the useEffect in main component
          }
          break;
        case 'Escape':
          e.preventDefault();
          setSelectedCategoryId(null);
          break;
      }

      if (newIndex !== currentIndex && newIndex >= 0) {
        setSelectedCategoryId(CATEGORIES[newIndex].id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCategoryId, setSelectedCategoryId]);

  return (
    <nav 
      className={cn(
        // kept your original sizing + background; appended any incoming className
        "w-[360px] h-screen bg-brand-left-column border-r border-border overflow-y-auto",
        className
      )}
      role="navigation"
      aria-label="RCM Categories"
    >
      {/* NOTE: replaced the previous p-4.space-y-2 wrapper with nav-list-tight to apply tighter spacing
          and still keep the original padding. */}
      <div className="p-4 nav-list-tight">
        {CATEGORIES.map((category, index) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategoryId(category.id)}
            // IMPORTANT: added 'nav-item' so your new CSS styles apply.
            className={cn(
              "nav-item", // <-- new
              "w-full h-12 px-4 rounded-lg text-left transition-all duration-200",
              "hover:bg-brand-card hover:shadow-sm",
              "focus:outline-none focus:ring-2 focus:ring-brand-accent focus:ring-offset-2 focus:ring-offset-brand-left-column",
              "border border-transparent",
              selectedCategoryId === category.id && [
                "bg-brand-panel shadow-sm",
                "border-l-4 border-l-brand-accent",
                "text-brand-charcoal font-medium"
              ]
            )}
            role="button"
            tabIndex={0}
            aria-selected={selectedCategoryId === category.id}
            aria-describedby={`category-${category.id}-desc`}
          >
            <div className="flex items-center justify-between h-full">
              <div className="flex-1 min-w-0">
                <div className={cn(
                  "cat-title text-sm truncate",
                  selectedCategoryId === category.id 
                    ? "text-brand-charcoal font-medium" 
                    : "text-brand-charcoal/80"
                )}>
                  {category.label}
                </div>
              </div>
              <div className={cn(
                "text-xs font-medium px-2 py-1 rounded-full cat-badge",
                selectedCategoryId === category.id
                  ? "bg-brand-accent/10 text-brand-accent"
                  : "bg-brand-muted-text/10 text-brand-muted-text"
              )}>
                {index + 1}
              </div>
            </div>
          </button>
        ))}
      </div>
    </nav>
  );
};
