# AI-Native RCM - Humaein

A comprehensive Revenue Cycle Management platform built with React, TypeScript, and Tailwind CSS.

## Features

- **10 RCM Stages**: Complete workflow from eligibility checking to reconciliation
- **Responsive Design**: Desktop persistent panel, mobile inline insertion
- **Accessibility**: WCAG AA compliant with full keyboard navigation
- **Data Upload**: CSV/JSON file processing with column mapping
- **Patient Lookup**: Minimal identifiers with smart prefilling
- **DevMode**: Debug logging with PII redaction
- **Dark/Light Theme**: Automatic theme switching

## Quick Start

```bash
# Install dependencies
yarn install

# Start development server
yarn dev

# Build for production
yarn build
```

## Configuration

### API Endpoints

Replace the API base URL in `src/config/api.ts`:

```typescript
export const API_BASE = "https://your-api-base-url.com";
```

### Payer Seeds

Customize payer options in `src/data/payers.ts` by modifying the `PAYER_SEEDS` array.

## Architecture

### Layout Behavior

- **Desktop (≥1024px)**: Persistent right panel (640px width) positioned absolutely
- **Mobile (<640px)**: Inline insertion under clicked category (accordion style)
- **Tablet (640px-1023px)**: Uses desktop layout

### Accessibility Features

- Full keyboard navigation (Arrow keys, Enter, Escape)
- Screen reader support with proper ARIA labels
- Focus management with automatic panel title focusing
- High contrast theme support

### Component Structure

```
src/
├── components/
│   ├── forms/                 # Form components for each stage
│   ├── ComboSearchInput.tsx   # Payer search with fuzzy filtering
│   ├── FileUploader.tsx       # Multi-format file upload
│   ├── LeftNavStages.tsx      # Category navigation
│   └── PersistentPanel.tsx    # Main interactive panel
├── contexts/
│   └── RCMContext.tsx         # Global state management
├── data/                      # Static data (categories, payers)
├── hooks/                     # Custom React hooks
└── types/                     # TypeScript interfaces
```

## Development

### Key Interaction Rules

1. **Single-click category switching** - No double-click required
2. **One option open at a time** - Opening new option auto-collapses previous
3. **Category switching collapses options** - Fresh state per category
4. **Minimal identifiers per stage** - Only required fields shown

### Testing

Run the test suite:

```bash
yarn test
```

### Storybook

View component stories:

```bash
yarn storybook
```

## API Integration

### Endpoint Mapping

Each stage maps to specific API endpoints defined in `src/config/api.ts`:

- Check Eligibility → `CHECK_ELIGIBILITY_ENDPOINT` / `CHECK_ELIGIBILITY_DB_ENDPOINT`
- Prior Authorization → `PRIOR_AUTH_ENDPOINT`
- Clinical Documentation → `CLINICAL_DOCUMENT_UPLOAD_ENDPOINT`
- Medical Coding → `MEDICAL_CODING_ENDPOINT`
- Claims Scrubbing → `CLAIMS_SCRUB_ENDPOINT`
- Claims Submission → `CLAIMS_SUBMIT_ENDPOINT`
- Remittance → `REMITTANCE_ENDPOINT`
- Denial Management → `DENIAL_MANAGEMENT_ENDPOINT`
- Resubmit → `RESUBMIT_ENDPOINT`
- Reconciliation → `RECONCILIATION_ENDPOINT`

### Patient Lookup

All stages use `PATIENT_LOOKUP_ENDPOINT` to enrich minimal identifiers with full patient data.

## Theme Customization

The design system is built on HSL color tokens in `src/index.css`:

```css
:root {
  --brand-bg: 187 25% 96%;
  --brand-accent: 187 100% 27%;
  --brand-accent-2: 183 100% 35%;
  /* ... */
}
```

Extend the theme in `tailwind.config.ts` for additional brand colors and gradients.