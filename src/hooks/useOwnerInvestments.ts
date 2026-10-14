import { useEffect, useRef, useState } from 'react';
import { investmentService } from '../services/investmentService';
import {
  OWNER_INVESTMENTS_IDLE,
  createOwnerInvestmentsLoader,
  ownerInvestmentsFor,
  ownerInvestmentsKey,
  type OwnerInvestmentsState,
} from '../services/ownerInvestmentsLoader';

/**
 * Investimentos por proprietário para o Dashboard. `enabled = false` (flag desligada ou sem data) não consulta nada.
 */
export function useOwnerInvestments(
  enabled: boolean,
  scopeKey: string,
  endDate: Date | null | undefined,
  ownerUserIds: readonly string[]
): OwnerInvestmentsState {
  const [state, setState] = useState<OwnerInvestmentsState>(OWNER_INVESTMENTS_IDLE);
  const loaderRef = useRef(
    createOwnerInvestmentsLoader((end, owners) => investmentService.getLatestPositionsByOwner(end, owners), setState)
  );
  const key = enabled && endDate && ownerUserIds.length > 0 ? ownerInvestmentsKey(scopeKey, endDate, ownerUserIds) : null;

  useEffect(() => {
    if (!key || !endDate) return;
    void loaderRef.current(key, endDate, ownerUserIds);
  }, [key]);

  return ownerInvestmentsFor(state, key);
}
