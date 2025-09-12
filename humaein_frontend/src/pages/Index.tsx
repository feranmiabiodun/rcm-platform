import React from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useRCM } from "@/contexts/RCMContext";
import { LeftNavStages } from "@/components/LeftNavStages";
import { PersistentPanel } from "@/components/PersistentPanel";
import { CATEGORIES } from "@/data/categories";
import TopBar from "@/components/TopBar";

const Index = () => {
  const { selectedCategoryId, setSelectedCategoryId } = useRCM();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isMobile = useMediaQuery("(max-width: 639px)");

  return (
    <div className="min-h-screen w-full bg-brand-bg flex flex-col">
      {/* Global top bar, always visible */}
      <TopBar />

      {/* Desktop Layout (≥1024px): Left nav + persistent panel */}
      {isDesktop && (
        <div className="flex flex-1">
          <LeftNavStages />
          <PersistentPanel />
        </div>
      )}

      {/* Mobile Layout (<640px): Inline panel after category */}
      {isMobile && (
        <div className="flex-1 w-full p-4 space-y-2">
          {CATEGORIES.map((category) => (
            <div key={category.id}>
              {/* Category Button */}
              <button
                onClick={() => setSelectedCategoryId(category.id)}
                className={`w-full h-12 px-4 rounded-lg text-left transition-all duration-200 border ${
                  selectedCategoryId === category.id
                    ? "bg-brand-panel shadow-sm border-l-4 border-l-brand-accent text-brand-charcoal font-medium"
                    : "bg-brand-left-column hover:bg-brand-card hover:shadow-sm border-transparent"
                }`}
              >
                <div className="flex items-center justify-between h-full">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate text-brand-charcoal">
                      {category.label}
                    </div>
                  </div>
                  <div
                    className={`text-xs font-medium px-2 py-1 rounded-full ${
                      selectedCategoryId === category.id
                        ? "bg-brand-accent/10 text-brand-accent"
                        : "bg-brand-muted-text/10 text-brand-muted-text"
                    }`}
                  >
                    {CATEGORIES.indexOf(category) + 1}
                  </div>
                </div>
              </button>

              {/* Inline Panel (only shows for selected category) */}
              {selectedCategoryId === category.id && (
                <div className="mt-4 mb-6">
                  <PersistentPanel />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tablet Layout (640px–1023px): mimic desktop */}
      {!isDesktop && !isMobile && (
        <div className="flex flex-1">
          <LeftNavStages />
          <PersistentPanel />
        </div>
      )}
    </div>
  );
};

export default Index;
