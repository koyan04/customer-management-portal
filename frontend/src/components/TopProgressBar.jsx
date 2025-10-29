import React from 'react';

// Simple top-of-page indeterminate progress bar.
// Usage: <TopProgressBar active={loading} />
export default function TopProgressBar({ active = false }) {
  return (
    <div className={`top-progress${active ? ' active' : ''}`} aria-hidden>
      <div className="top-progress-bar" />
      <div className="top-progress-stripe" />
    </div>
  );
}
