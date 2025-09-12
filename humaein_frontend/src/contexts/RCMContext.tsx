/* eslint-disable react-refresh/only-export-components */
/* Reason: this file exports React context and provider helpers (useRCM, RCMProvider).
   Moving these to separate modules would be the cleaner long-term fix, but to keep this change
   minimal and avoid touching imports across the repo, we disable the rule for this file. */

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { PatientLookupResponse } from '@/types/rcm';

interface ApiLog {
  id: string;
  timestamp: Date;
  endpoint: string;
  request: unknown;
  response: unknown;
}

interface RCMContextType {
  selectedCategoryId: string | null;
  setSelectedCategoryId: (id: string | null) => void;
  expandedOptionId: string | null;
  setExpandedOptionId: (id: string | null) => void;
  isDarkMode: boolean;
  setIsDarkMode: (dark: boolean) => void;
  isDevMode: boolean;
  setIsDevMode: (dev: boolean) => void;
  patientData: PatientLookupResponse | null;
  setPatientData: (data: PatientLookupResponse | null) => void;
  apiLogs: ApiLog[];
  addApiLog: (endpoint: string, request: unknown, response: unknown) => void;
}

const RCMContext = createContext<RCMContextType | undefined>(undefined);

export const useRCM = () => {
  const context = useContext(RCMContext);
  if (context === undefined) {
    throw new Error('useRCM must be used within a RCMProvider');
  }
  return context;
};

interface RCMProviderProps {
  children: ReactNode;
}

export const RCMProvider: React.FC<RCMProviderProps> = ({ children }) => {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [isDevMode, setIsDevMode] = useState<boolean>(false);
  const [patientData, setPatientData] = useState<PatientLookupResponse | null>(null);
  const [apiLogs, setApiLogs] = useState<ApiLog[]>([]);

  const addApiLog = (endpoint: string, request: unknown, response: unknown) => {
    const log: ApiLog = {
      id: Date.now().toString(),
      timestamp: new Date(),
      endpoint,
      request,
      response
    };
    setApiLogs(prev => [log, ...prev.slice(0, 49)]); // Keep last 50 logs
  };

  // Auto-collapse option when switching categories
  const handleSetSelectedCategory = (id: string | null) => {
    setSelectedCategoryId(id);
    setExpandedOptionId(null); // Collapse any open option
  };

  // Auto-collapse previous option when opening new one
  const handleSetExpandedOption = (id: string | null) => {
    setExpandedOptionId(id);
  };

  React.useEffect(() => {
    // Apply dark mode class to document
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  React.useEffect(() => {
    // DevMode keyboard shortcut
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'd') {
        e.preventDefault();
        setIsDevMode(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const value = {
    selectedCategoryId,
    setSelectedCategoryId: handleSetSelectedCategory,
    expandedOptionId,
    setExpandedOptionId: handleSetExpandedOption,
    isDarkMode,
    setIsDarkMode,
    isDevMode,
    setIsDevMode,
    patientData,
    setPatientData,
    apiLogs,
    addApiLog
  };

  return (
    <RCMContext.Provider value={value}>
      {children}
    </RCMContext.Provider>
  );
};
