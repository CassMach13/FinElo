import React from 'react';
import FamilyOwnerBadge from './FamilyOwnerBadge';
import type { FamilyOwnerProfile } from '../../utils/familyOwnerContext';

interface TransactionOwnerGroupHeaderProps {
  profile: FamilyOwnerProfile;
  count: number;
  variant?: 'card' | 'table';
}

const TransactionOwnerGroupHeader: React.FC<TransactionOwnerGroupHeaderProps> = ({
  profile,
  count,
  variant = 'card',
}) => {
  const label = `${profile.label} — ${count} lançamento${count === 1 ? '' : 's'}`;

  if (variant === 'table') {
    return (
      <div className="flex items-center gap-2 py-1">
        <FamilyOwnerBadge profile={profile} compact />
        <span className="text-xs font-bold text-slate-200">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-slate-900/50">
      <FamilyOwnerBadge profile={profile} compact />
      <span className="text-sm font-bold text-white">{label}</span>
    </div>
  );
};

export default TransactionOwnerGroupHeader;
