/// <reference types="vite/client" />

// Allow importing image files in TypeScript (Vite will handle them at build time)
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.webp';
declare module '*.svg';

// Simple fallback for packages without types 
declare module 'lucide-react';
