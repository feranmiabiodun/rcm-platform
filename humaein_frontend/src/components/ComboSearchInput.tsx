import React, { useState, useMemo } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PAYER_SEEDS } from '@/data/payers';
import { PayerSeed } from '@/types/rcm';

interface ComboSearchInputProps {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const ComboSearchInput: React.FC<ComboSearchInputProps> = ({
  value = '',
  onValueChange,
  placeholder = 'Select payer...',
  className,
  disabled = false
}) => {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredPayers = useMemo(() => {
    if (!searchTerm) return PAYER_SEEDS;
    
    const term = searchTerm.toLowerCase();
    return PAYER_SEEDS.filter(payer => 
      payer.displayName.toLowerCase().includes(term) ||
      payer.name.toLowerCase().includes(term)
    );
  }, [searchTerm]);

  const selectedPayer = PAYER_SEEDS.find(payer => payer.name === value);
  const hasCustomPayer = value && !selectedPayer;

  const handleSelect = (payerName: string) => {
    onValueChange?.(payerName);
    setOpen(false);
    setSearchTerm('');
  };

  const handleCustomPayer = () => {
    if (searchTerm.trim()) {
      onValueChange?.(searchTerm.trim());
      setOpen(false);
      setSearchTerm('');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between bg-brand-panel border-border hover:bg-brand-left-column transition-smooth",
            !value && "text-brand-muted-text",
            className
          )}
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-brand-muted-text" />
            <span className="truncate">
              {selectedPayer?.displayName || value || placeholder}
            </span>
          </div>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0 bg-brand-panel border-border shadow-panel">
        <Command>
          <CommandInput
            placeholder="Search payers..."
            value={searchTerm}
            onValueChange={setSearchTerm}
            className="border-0 focus:ring-0"
          />
          <CommandList>
            <CommandEmpty>
              <div className="p-2">
                <p className="text-sm text-brand-muted-text mb-2">No payer found.</p>
                {searchTerm.trim() && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCustomPayer}
                    className="w-full"
                  >
                    Use custom payer "{searchTerm.trim()}"
                  </Button>
                )}
              </div>
            </CommandEmpty>
            <CommandGroup>
              {filteredPayers.map((payer) => (
                <CommandItem
                  key={payer.id}
                  value={payer.name}
                  onSelect={() => handleSelect(payer.name)}
                  className="cursor-pointer hover:bg-brand-left-column"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === payer.name ? "opacity-100 text-brand-accent" : "opacity-0"
                    )}
                  />
                  <div>
                    <div className="font-medium">{payer.displayName}</div>
                    <div className="text-xs text-brand-muted-text">{payer.name}</div>
                  </div>
                </CommandItem>
              ))}
              {searchTerm.trim() && !filteredPayers.some(p => p.name.toLowerCase() === searchTerm.toLowerCase()) && (
                <CommandItem
                  value={`custom-${searchTerm}`}
                  onSelect={handleCustomPayer}
                  className="cursor-pointer hover:bg-brand-left-column border-t border-border"
                >
                  <div className="w-full">
                    <div className="font-medium text-brand-accent">
                      Use custom payer "{searchTerm.trim()}"
                    </div>
                    <div className="text-xs text-brand-muted-text">
                      Add custom payer not in the list
                    </div>
                  </div>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};