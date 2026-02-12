# Accessibility Fallbacks

## Overview

Canvas and WebGL renderers require special accessibility considerations since they don't have native DOM elements for screen readers to interact with. This document describes the fallback mechanisms to ensure all users can access the data.

## Core Accessibility Requirements

### 1. Screen Reader Support

All visualizations must provide:
- Text alternatives for charts
- Data summaries for context
- Status updates on interaction
- Keyboard-accessible controls

### 2. Keyboard Navigation

Users must be able to:
- Navigate data points with arrow keys
- Select points with Enter/Space
- Access all features without a mouse

### 3. Reduced Motion Support

Respect user preferences:
- Disable animations when `prefers-reduced-motion: reduce`
- Instant state transitions instead of animated
- No auto-playing motion

## Fallback Mechanisms

### 1. Data Table Fallback

Generate an accessible HTML table from the data:

```typescript
import { generateDataTable } from '@/lib/viz/hybrid';

const { columns, rows, truncated } = generateDataTable(data, 100);

// Render as HTML table
<table>
  <thead>
    <tr>{columns.map(col => <th>{col.header}</th>)}</tr>
  </thead>
  <tbody>
    {rows.map(row => (
      <tr>{columns.map(col => <td>{row[col.key]}</td>)}</tr>
    ))}
  </tbody>
</table>
```

**Features:**
- Configurable max rows (default 100)
- Sortable columns
- Search/filter support
- Truncation warning if data exceeds limit

### 2. ARIA Attributes

Generate appropriate ARIA attributes for chart containers:

```typescript
import { generateAriaAttributes } from '@/lib/viz/hybrid';

const attributes = generateAriaAttributes(
  {
    ariaLabel: 'Revenue over time',
    ariaDescription: 'Line chart showing monthly revenue',
  },
  data
);

// Returns:
// {
//   role: 'img',
//   'aria-label': 'Revenue over time',
//   'aria-description': 'Line chart... Contains 2 series with 1000 points',
//   tabindex: '0'
// }
```

### 3. Data Summaries

Generate text summaries for screen readers:

```typescript
import { generateDataSummary, generateTextSummary } from '@/lib/viz/hybrid';

const summary = generateDataSummary(data);
const text = generateTextSummary(summary);

// Example output:
// "Chart contains 2 data series with 2000 total data points.
//  Time range: Jan 1, 2024 to Feb 1, 2024.
//  Value range: 10.5 to 89.3.
//  Found 5 anomalous data points.
//  Primary Metric shows strong upward trend.
//  Secondary Metric shows stable trend."
```

**Summary includes:**
- Series and point counts
- Time range
- Value range
- Anomaly detection
- Trend analysis

### 4. Keyboard Shortcuts

Document and implement keyboard navigation:

```typescript
import { KEYBOARD_SHORTCUTS, generateKeyboardHelp } from '@/lib/viz/hybrid';

// Available shortcuts:
// ArrowLeft: Move to previous data point
// ArrowRight: Move to next data point
// ArrowUp: Move to series above
// ArrowDown: Move to series below
// Enter: Select current data point
// Space: Toggle selection
// Escape: Clear selection
// T: Toggle table view
// S: Announce summary
```

### 5. Reduced Motion Detection

```typescript
import { prefersReducedMotion, getAnimationDuration } from '@/lib/viz/hybrid';

// Check user preference
if (prefersReducedMotion()) {
  // Disable animations
  transitionDuration = 0;
} else {
  transitionDuration = getAnimationDuration(300); // 300ms or 0
}
```

### 6. High Contrast Mode

```typescript
import { isHighContrastMode, getContrastColors } from '@/lib/viz/hybrid';

// Get appropriate colors
const { colors, lineWidth } = getContrastColors([
  '#3b82f6',
  '#10b981',
  '#f59e0b'
]);

// High contrast: returns black/white/high-contrast colors
// Normal: returns original colors
```

## Implementation Guidelines

### Chart Container Setup

```tsx
<div
  role="img"
  aria-label="Data visualization"
  aria-describedby="chart-summary"
  tabIndex={0}
  className="chart-container"
>
  {/* Canvas/WebGL renderer here */}
</div>

<div id="chart-summary" className="sr-only">
  {generateTextSummary(generateDataSummary(data))}
</div>
```

### Toggle Button for Table View

```tsx
<button
  onClick={() => setShowTable(!showTable)}
  aria-expanded={showTable}
  aria-controls="data-table"
>
  {showTable ? 'Hide' : 'Show'} Data Table
</button>

{showTable && (
  <div id="data-table">
    {/* Render data table */}
  </div>
)}
```

### Live Region for Updates

```tsx
<div role="status" aria-live="polite" className="sr-only">
  {hoverInfo && `Hovering over ${hoverInfo.series}: ${hoverInfo.point.y}`}
  {selection.length > 0 && `${selection.length} points selected`}
</div>
```

## Screen Reader Testing

### Recommended Tools

1. **NVDA** (Windows) - Free, widely used
2. **JAWS** (Windows) - Industry standard
3. **VoiceOver** (macOS/iOS) - Built-in
4. **TalkBack** (Android) - Built-in

### Testing Checklist

- [ ] Chart has appropriate role and label
- [ ] Data summary is announced on focus
- [ ] Table view is accessible
- [ ] Keyboard navigation works
- [ ] Selection changes are announced
- [ ] No keyboard traps
- [ ] Reduced motion respected

### Test Script

```
1. Tab to chart container
   Expected: "Data visualization, image. Revenue over time..."

2. Press T to toggle table
   Expected: "Data table expanded. 100 rows."

3. Navigate table with arrow keys
   Expected: "Row 1, Series: Primary, Value: 45.2"

4. Press Escape
   Expected: "Table collapsed"

5. Use arrow keys in chart
   Expected: "Series Primary, point 1 of 100, value 45.2"

6. Press Enter to select
   Expected: "Selected. 1 point selected."
```

## Fallback Behavior Matrix

| Feature | SVG | Canvas | WebGL |
|---------|-----|--------|-------|
| Native screen reader | ✅ Yes | ❌ No | ❌ No |
| Table fallback | Optional | Required | Required |
| ARIA attributes | Good | Required | Required |
| Keyboard nav | Native | Emulated | Emulated |
| Reduced motion | CSS | JS detection | JS detection |

## Common Issues

### Canvas/WebGL Not Announced

**Problem:** Screen reader skips over canvas

**Solution:** Ensure proper ARIA attributes:
```typescript
role="img"
aria-label="Description of chart"
tabIndex={0}
```

### Keyboard Navigation Not Working

**Problem:** Can't navigate with Tab/Arrow keys

**Solution:**
1. Ensure `tabIndex={0}` on container
2. Attach keyboard event listeners
3. Implement focus management

### Data Table Too Large

**Problem:** Screen reader overwhelmed by 50k rows

**Solution:**
```typescript
const { rows, truncated } = generateDataTable(data, 100);
// Only show first 100 rows
// Add note: "Showing 100 of 50000 rows"
```

## Best Practices

1. **Always provide table fallback** for Canvas/WebGL
2. **Test with actual screen readers**, not just automated tools
3. **Use semantic HTML** for table, not just styled divs
4. **Announce important changes** via live regions
5. **Respect user preferences** (motion, contrast)
6. **Document keyboard shortcuts** visibly
7. **Don't rely on color alone** - use patterns/shapes

## WCAG Compliance

### Level A (Required)
- 1.1.1 Non-text Content - Table fallback
- 2.1.1 Keyboard - Full keyboard access
- 2.2.2 Pause, Stop, Hide - Reduced motion
- 4.1.2 Name, Role, Value - ARIA attributes

### Level AA (Recommended)
- 1.4.3 Contrast (Minimum) - High contrast mode
- 1.4.11 Non-text Contrast - Shape/pattern differentiation
- 2.4.7 Focus Visible - Clear focus indicators

### Level AAA (Optional)
- 1.4.6 Contrast (Enhanced) - 7:1 ratio
- 2.4.10 Section Headings - Structured content
