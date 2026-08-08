import { describe, expect, it } from 'vitest';
import {
  deriveInitialDataLoadStatusForUser,
  getDashboardDataDisplayState,
} from '../src/utils/initialDataLoad';

describe('initialDataLoad', () => {
  it('starts a protected load when a different authenticated user enters', () => {
    expect(deriveInitialDataLoadStatusForUser('idle', null, 'user-a')).toBe('loading');
    expect(deriveInitialDataLoadStatusForUser('ready', 'user-a', 'user-b')).toBe('loading');
  });

  it('preserves the completed state when the same user refreshes the session', () => {
    expect(deriveInitialDataLoadStatusForUser('ready', 'user-a', 'user-a')).toBe('ready');
  });

  it('returns to idle after sign-out', () => {
    expect(deriveInitialDataLoadStatusForUser('ready', 'user-a', null)).toBe('idle');
  });

  it('never treats an unfinished or failed load as an empty account', () => {
    expect(getDashboardDataDisplayState('idle', 0)).toBe('loading');
    expect(getDashboardDataDisplayState('loading', 0)).toBe('loading');
    expect(getDashboardDataDisplayState('error', 0)).toBe('error');
  });

  it('shows the demo state only after a successful empty load', () => {
    expect(getDashboardDataDisplayState('ready', 0)).toBe('empty');
    expect(getDashboardDataDisplayState('ready', 3768)).toBe('ready');
  });
});
