import React from 'react';
import type { FamilyOwnerProfile } from '../../utils/familyOwnerContext';

interface FamilyOwnerBadgeProps {
  profile: FamilyOwnerProfile;
  className?: string;
  compact?: boolean;
}

const FamilyOwnerBadge: React.FC<FamilyOwnerBadgeProps> = ({
  profile,
  className = '',
  compact = false,
}) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full border font-bold uppercase tracking-wide whitespace-nowrap ${profile.chipClass} ${
      compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'
    } ${className}`}
    title={profile.email}
  >
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${profile.dotClass}`} aria-hidden />
    {profile.label}
  </span>
);

export default FamilyOwnerBadge;
