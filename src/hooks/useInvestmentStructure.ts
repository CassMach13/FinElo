import { useCallback, useEffect, useRef, useState } from 'react';
import { listHoldings, listPortfolios } from '../services/investmentStructureService';
import { STRUCTURE_OFF, createStructureLoader, structureFor, type StructureState } from '../services/investmentStructureLoader';

/** Carteiras (inclusive arquivadas) e holdings do proprietário consultado. `enabled = false` não faz nenhuma consulta. */
export function useInvestmentStructure(enabled: boolean, ownerUserId: string | null | undefined) {
  const [state, setState] = useState<StructureState>(STRUCTURE_OFF);
  const loaderRef = useRef(
    createStructureLoader(
      {
        listPortfolios: (owner) => listPortfolios({ ownerUserId: owner, includeArchived: true }),
        listHoldings: (owner) => listHoldings({ ownerUserId: owner }),
      },
      (update) => setState(update)
    )
  );
  const reload = useCallback(() => loaderRef.current(enabled, ownerUserId), [enabled, ownerUserId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { ...structureFor(state, enabled ? ownerUserId : null), reload };
}
