import React from 'react';

interface ProgressBarProps {
  value: number;
  max: number;
  expectedPacing?: number; // 0.0 to 1.0 (defaults to 1.0 if not provided)
}

const ProgressBar: React.FC<ProgressBarProps> = ({ value, max, expectedPacing }) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  const clampedPercentage = Math.min(percentage, 100);

  let barColor = 'bg-accent'; // Default to green

  if (expectedPacing !== undefined && expectedPacing >= 0) {
    // Dynamic pacing logic
    const expectedValue = max * expectedPacing;

    // We give a tiny 5% tolerance
    if (value > max || value > expectedValue * 1.20) {
      barColor = 'bg-danger'; // Over 20% above expected - Red
    } else if (value > expectedValue * 1.05) {
      barColor = 'bg-yellow-500'; // Slightly above expected - Yellow
    }
  } else {
    // Fallback logic for basic progress bars
    barColor = percentage > 100 ? 'bg-danger' : percentage > 80 ? 'bg-yellow-500' : 'bg-accent';
  }

  return (
    <div className="w-full bg-primary rounded-full h-2.5">
      <div
        className={`${barColor} h-2.5 rounded-full transition-all duration-500`}
        style={{ width: `${clampedPercentage}%` }}
      ></div>
    </div>
  );
};

export default ProgressBar;
