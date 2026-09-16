import React from 'react';
import { AppState } from 'react-native';
import { render, waitFor, screen, act } from '@testing-library/react-native';
import { AllProviders } from '../../../../test/renderWithProviders';
import { sessionStore } from '../../../lib/sessionStore';
import CapsuleDetailScreen from '../CapsuleDetailScreen';

// Regression test for: once load() fails and sets the main component's
// `error` state ("Failed to load capsule."), nothing in the component ever
// clears it — so a LATER successful load() (foreground AppState refetch,
// focus re-fetch, unlock poll) still renders the dead-end error screen
// forever, even though fresh capsule data has landed.
//
// This reproduces the AppState leg specifically: the first `capsules` fetch
// fails (shows the error screen), then the app is foregrounded (AppState
// 'active'), which calls load() again — this time it succeeds. The bug:
// the screen keeps showing "Failed to load capsule." forever instead of the
// now-loaded capsule.

const CAPSULE_ID = 'c-error-clear';
const OWNER_ID = 'owner-1';

// Captured by spying on the real (jest-expo-mocked) AppState.addEventListener
// below, rather than jest.mock('react-native', ...) — replacing the whole
// react-native module bypasses jest-expo's own native-module mocking and
// breaks unrelated things (DevMenu, etc). Spying on the shared singleton
// AppState object works because this test file and CapsuleDetailScreen.tsx
// both import the same module instance.
let mockAppStateListener: ((state: string) => void) | null = null;

const CAPSULE_ROW = {
  id: CAPSULE_ID,
  owner_id: OWNER_ID,
  title: 'Trip',
  description: '',
  status: 'unlocked', // avoids the locked/surprise-mode branch entirely
  unlock_at: '2026-01-01T00:00:00.000Z',
  unlock_mode: 'time',
  owner_preview_locked: false,
  contribution_lock_at: null,
  contribution_start_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  archived_at: null,
  occasion: 'general',
  superlative_voting_closes_at: null,
  superlative_voting_finalized_at: null,
  live_activity_enabled: false,
  owner: { subscription_tier: 'free' },
};

const MEMBER_ROWS = [
  {
    user_id: OWNER_ID,
    role: 'owner',
    joined_at: '2025-01-01T00:00:00.000Z',
    archived_at: null,
    checkin_at: null,
    live_activity_override: null,
    users: { display_name: 'Owner', avatar_url: null },
  },
];

jest.mock('../../../lib/supabase', () => {
  function mockBuilder(table: string) {
    let single = false;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      is: () => chain,
      not: () => chain,
      filter: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      single: () => { single = true; return chain; },
      maybeSingle: () => { single = true; return chain; },
      insert: () => chain,
      update: () => chain,
      delete: () => chain,
      then: (resolve: (v: any) => void) => {
        if (table === 'capsules') {
          mockCapsulesCallCount++;
          if (mockCapsulesCallCount === 1) {
            resolve({ data: null, error: { message: 'network error' } });
            return;
          }
          resolve({ data: single ? mockCapsuleRow : [mockCapsuleRow], error: null });
          return;
        }
        if (table === 'capsule_members') {
          resolve({ data: mockMemberRows, error: null });
          return;
        }
        // media / everything else this screen touches on mount
        resolve({ data: [], error: null });
      },
    };
    return chain;
  }

  return {
    supabase: {
      from: mockBuilder,
      rpc: jest.fn(() => Promise.resolve({ data: null, error: null })),
      storage: {
        from: () => ({
          createSignedUrls: jest.fn(() => Promise.resolve({ data: [], error: null })),
          remove: jest.fn(() => Promise.resolve({ data: null, error: null })),
        }),
      },
      channel: jest.fn(() => ({
        on: jest.fn().mockReturnThis(),
        subscribe: jest.fn().mockReturnThis(),
      })),
      removeChannel: jest.fn(),
      auth: {
        getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
    },
    getFreshAccessToken: jest.fn(() => Promise.resolve('test-token')),
    getFreshSession: jest.fn(() => Promise.resolve({ accessToken: 'test-token', userId: OWNER_ID })),
  };
});

// Re-exported under `mock`-prefixed names so the jest.mock factory above
// (which closes over them) satisfies jest's out-of-scope-variable rule.
const mockCapsuleRow = CAPSULE_ROW;
const mockMemberRows = MEMBER_ROWS;
// eslint-disable-next-line prefer-const
let mockCapsulesCallCount = 0;

function makeNavigation() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    isFocused: jest.fn(() => true),
  } as any;
}

describe('CapsuleDetailScreen error-state regression', () => {
  beforeEach(() => {
    mockCapsulesCallCount = 0;
    mockAppStateListener = null;
    sessionStore.set({ user: { id: OWNER_ID } } as any);
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((event: string, cb: (state: string) => void) => {
      if (event === 'change') mockAppStateListener = cb;
      return { remove: jest.fn() };
    }) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clears the error banner once a later load() succeeds', async () => {
    await render(
      <AllProviders>
        <CapsuleDetailScreen
          route={{ key: 'CapsuleDetail', name: 'CapsuleDetail', params: { capsuleId: CAPSULE_ID } } as any}
          navigation={makeNavigation()}
        />
      </AllProviders>,
    );

    // First load() fails -> the dead-end error screen shows.
    await waitFor(() => expect(screen.getByText('Failed to load capsule.')).toBeTruthy());

    // Foreground the app — CapsuleDetailScreen's AppState listener calls
    // load() again, and this time the fetch succeeds.
    expect(mockAppStateListener).not.toBeNull();
    await act(async () => {
      mockAppStateListener!('active');
    });

    // The capsule loaded successfully — the error banner must be gone and
    // the real screen (with the capsule's title) must render instead.
    await waitFor(() => expect(screen.queryByText('Failed to load capsule.')).toBeNull());
    expect(screen.getByText('Trip')).toBeTruthy();
  });
});
