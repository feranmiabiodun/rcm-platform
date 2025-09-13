import React, { FC, useEffect, useRef, useState } from "react";
import { Settings, HelpCircle, Sun, Moon, User, X as XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectTrigger,
} from "@/components/ui/select";
import { useRCM } from "@/contexts/RCMContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CATEGORIES } from "@/data/categories";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Built-in quick-start summaries keyed by category label.
 */
const QUICK_SUMMARIES: Record<string, React.ReactNode> = {
  "Check Eligibility": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Collect patient identifiers: full name, DOB, member ID.</li>
        <li>Select payer & plan, enter service date and procedure type.</li>
        <li>Run eligibility check; note coverage limits, copays, and pre-reqs.</li>
      </ul>
    </div>
  ),
  "Prior Authorization": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Gather clinical rationale and required documentation (notes, imaging).</li>
        <li>Pick correct CPT/HCPCS codes and urgency level; complete PA form.</li>
        <li>Submit to payer, capture request ID, and track status until approved.</li>
      </ul>
    </div>
  ),
  "Clinical Documentation": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Ensure H&P, vitals, and relevant test results are included.</li>
        <li>Document medical necessity clearly (symptoms, findings, plan).</li>
        <li>Attach or link supporting files so coders and payers can verify.</li>
      </ul>
    </div>
  ),
  "Medical Coding": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Map diagnoses to ICD-10 and procedures to CPT/HCPCS accurately.</li>
        <li>Apply correct modifiers, check laterality and bundling rules.</li>
        <li>Validate codes against documentation and payer-specific rules.</li>
      </ul>
    </div>
  ),
  "Claims Scrubbing": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Run automated edits: missing fields, invalid codes, and duplicates.</li>
        <li>Fix structural errors (NPI, taxonomy, DOB, member ID, dates of service).</li>
        <li>Resolve payer edits before submission to reduce rejections/denials.</li>
      </ul>
    </div>
  ),
  "Claims Submission": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Select clearinghouse/endpoint and ensure batch files are valid.</li>
        <li>Transmit claims; confirm acceptance/acknowledgement messages.</li>
        <li>Monitor for rejections and correct promptly to resubmit.</li>
      </ul>
    </div>
  ),
  "Remittance": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Retrieve EOB/ERA from payer and match remittance to claims.</li>
        <li>Post payments to patient/provider accounts and note adjustments.</li>
        <li>Flag and investigate mismatches or short pays for follow-up.</li>
      </ul>
    </div>
  ),
  "Denial Management": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Identify denial reason code and categorize by root cause.</li>
        <li>Gather supporting documentation or corrected data for appeal.</li>
        <li>Submit appeal or corrected claim within payer deadlines; track responses.</li>
      </ul>
    </div>
  ),
  "Resubmit": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Correct errors indicated by rejection/denial (codes, data, attachments).</li>
        <li>Include corrected claim form and a note explaining the change.</li>
        <li>Resubmit to the correct payer endpoint and verify acceptance.</li>
      </ul>
    </div>
  ),
  "Reconciliation": (
    <div>
      <ul className="list-disc pl-4 text-xs leading-relaxed">
        <li>Compare expected payments to actual remittances and post entries.</li>
        <li>Reconcile unapplied payments and match AR to clearinghouse reports.</li>
        <li>Document and escalate unresolved discrepancies for finance review.</li>
      </ul>
    </div>
  ),
};

/**
 * Safely extract a category-provided summary or description without using `any`.
 */
function getCategoryProvidedContent(categoryItem: unknown): string | React.ReactNode | undefined {
  if (categoryItem && typeof categoryItem === "object") {
    const obj = categoryItem as Record<string, unknown>;
    if (obj.summary !== undefined) {
      const s = obj.summary;
      if (typeof s === "string" || React.isValidElement(s)) return s as string | React.ReactNode;
    }
    if (obj.description !== undefined) {
      const d = obj.description;
      if (typeof d === "string" || React.isValidElement(d)) return d as string | React.ReactNode;
    }
  }
  return undefined;
}

const TopBar: FC = () => {
  const { isDarkMode, setIsDarkMode } = useRCM();
  const isMobile = useIsMobile(); // 👈 detect mobile

  const [open, setOpen] = useState<boolean>(false);
  const [quickSelected, setQuickSelected] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLElement | null>(null);

  const scrollItemIntoView = (id: string) => {
    const el = itemRefs.current[id];
    if (!el) return;
    try {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    } catch {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const handleManualSelect = (id: string) => {
    setQuickSelected(id);
    window.dispatchEvent(new CustomEvent("quickstart-select", { detail: id }));
    setOpen(true);
    scrollItemIntoView(id);
    contentRef.current?.focus();
  };

  const closeAll = () => {
    setQuickSelected(null);
    setOpen(false);
  };

  const handleOpenChange = (val: boolean) => {
    setOpen(val);
  };

  const handleDropdownKeyDown = (e: React.KeyboardEvent) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();

    const ids = CATEGORIES.map((c) => c.id);
    const currentIndex = hoveredId ? ids.indexOf(hoveredId) : quickSelected ? ids.indexOf(quickSelected) : -1;

    let nextIndex = currentIndex;
    if (e.key === "ArrowDown") {
      nextIndex = currentIndex < ids.length - 1 ? currentIndex + 1 : 0;
    } else if (e.key === "ArrowUp") {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : ids.length - 1;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = ids.length - 1;
    }

    const nextId = ids[nextIndex];
    setHoveredId(nextId);
    scrollItemIntoView(nextId);
  };

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => contentRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <header
      className="topbar w-full inset-x-0 flex items-center justify-between px-6 py-3 shadow-sm sticky top-0 z-50 text-white"
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: isMobile ? 0 : "var(--scrollbar-width, 0px)", // 👈 existing behaviour preserved
          bottom: 0,
          zIndex: -1,
          pointerEvents: "none",
          backgroundColor: "var(--topbar-blue, hsl(215 65% 42%))",
          backgroundRepeat: "no-repeat",
          backgroundSize: "100% 100%",
          boxShadow: "0 8px 28px rgba(0,0,0,0.22)",
        }}
      />

      {/* Updated heading: non-breaking hyphen + explicit space between spans to ensure a gap when inline */}
      <h1 className="text-lg font-semibold leading-tight">
        <span className="block text-sm sm:inline whitespace-nowrap">AI&#8209;NATIVE</span>{' '}
        <span className="block sm:inline">RCM</span>
      </h1>

      {/* right-side controls (labelled so CSS can target it safely) */}
      <div className="topbar-right flex items-center gap-3">
        {/* center select wrapped so CSS can flex it in mobile without guessing other classes */}
        <div className="select-middle">
          <Select open={open} onOpenChange={handleOpenChange}>
            <SelectTrigger
              className="w-32 h-8 text-xs bg-white/10 text-white backdrop-blur-sm"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((prev) => !prev);
              }}
            >
              <span className="select-trigger-label">Quick Start</span>
            </SelectTrigger>

            <SelectContent
              className="bg-white"
              data-topbar-select
              ref={(el: HTMLElement | null) => {
                contentRef.current = el;
              }}
              tabIndex={0}
              onKeyDown={handleDropdownKeyDown}
            >
              <div className="sticky top-0 z-40 bg-white flex items-center justify-end px-2 py-1 border-b shadow-sm">
                <button
                  aria-label="Close Quick Start"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeAll();
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>

              {CATEGORIES.map((category) => {
                const id = category.id;
                const isActive = quickSelected === id;

                const fromCategories = getCategoryProvidedContent(category);
                const builtIn = QUICK_SUMMARIES[category.label] ?? null;
                const guideContent = fromCategories
                  ? typeof fromCategories === "string"
                    ? <div className="text-xs leading-relaxed">{fromCategories}</div>
                    : fromCategories
                  : builtIn;

                const isHovered = hoveredId === id;
                const hoverStyle: React.CSSProperties | undefined = isHovered
                  ? { background: "var(--hover-bg)", color: "white" }
                  : undefined;

                return (
                  <div key={id} className="w-full">
                    <div
                      role="button"
                      tabIndex={0}
                      ref={(el: HTMLDivElement | null) => {
                        itemRefs.current[id] = el;
                      }}
                      onPointerDown={(e: React.PointerEvent) => {
                        e.preventDefault();
                        handleManualSelect(id);
                      }}
                      onKeyDown={(e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleManualSelect(id);
                        }
                      }}
                      onMouseEnter={() => {
                        setHoveredId(id);
                        scrollItemIntoView(id);
                      }}
                      onMouseLeave={() => setHoveredId((h) => (h === id ? null : h))}
                      onFocus={() => {
                        setHoveredId(id);
                        scrollItemIntoView(id);
                      }}
                      onBlur={() => setHoveredId((h) => (h === id ? null : h))}
                      style={hoverStyle}
                      className={[
                        "relative flex w-full cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm outline-none",
                        "hover:text-white",
                      ].join(" ")}
                      data-topbar-item
                    >
                      <span className="min-w-0 truncate text-black">{category.label}</span>
                    </div>

                    {guideContent ? (
                      <div
                        aria-hidden={!isActive}
                        className={
                          "px-3 transition-all duration-200 ease-out overflow-hidden " +
                          (isActive ? "max-h-80 opacity-100 py-2" : "max-h-0 opacity-0 py-0")
                        }
                      >
                        <div className="rounded-md border border-border bg-white text-sm text-black p-2 shadow-sm">
                          <div className="text-xs leading-relaxed">
                            {guideContent}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white/90">
          <HelpCircle className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-white/90">
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-white/90"
          onClick={() => setIsDarkMode(!isDarkMode)}
        >
          {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <Avatar className="avatar h-8 w-8">
          <AvatarImage src="/api/placeholder/32/32" />
          <AvatarFallback className="bg-gradient-primary text-white text-xs">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
};

export default TopBar;
