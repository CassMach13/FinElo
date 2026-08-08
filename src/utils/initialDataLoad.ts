export type InitialDataLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export type DashboardDataDisplayState = 'loading' | 'error' | 'empty' | 'ready';

export const deriveInitialDataLoadStatusForUser = (
  currentStatus: InitialDataLoadStatus,
  currentUserId: string | null | undefined,
  nextUserId: string | null | undefined,
): InitialDataLoadStatus => {
  if (!nextUserId) return 'idle';
  if (nextUserId !== currentUserId) return 'loading';
  return currentStatus;
};

export const getDashboardDataDisplayState = (
  status: InitialDataLoadStatus,
  transactionCount: number,
): DashboardDataDisplayState => {
  if (status === 'error') return 'error';
  if (status !== 'ready') return 'loading';
  return transactionCount === 0 ? 'empty' : 'ready';
};
