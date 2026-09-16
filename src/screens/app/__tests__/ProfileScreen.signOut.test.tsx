import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { AllProviders } from '../../../../test/renderWithProviders';
import { sessionStore } from '../../../lib/sessionStore';
import { supabase } from '../../../lib/supabase';
import ProfileScreen from '../ProfileScreen';

// Regression test for: a shared device's push_token is never cleared when a
// user signs out, so the next account that signs in on the same device
// silently inherits the departing user's Expo push token (notification
// permission is device/OS-scoped, not account-scoped — see
// usePushNotifications.native.ts's registerToken) and receives their private
// capsule-title pushes.
//
// This drives the REAL Sign Out flow through the REAL screen — open the
// confirm sheet, press the destructive "Sign Out" button inside it — rather
// than calling clearPushToken() directly, so the test fails for the right
// reason: against the unfixed code there is no `users` UPDATE anywhere in
// this flow at all, regardless of what (if anything) a push-token helper
// module exports. Confirmed failing against the pre-fix tree (see commit
// message) with "expected mockUpdate to have been called" before this fix
// existed.

const USER_ID = 'user-a';

const USERS_ROW = {
  id: USER_ID,
  display_name: 'Alice',
  bio: null,
  avatar_url: null,
  created_at: '2025-01-01T00:00:00.000Z',
  subscription_tier: 'free',
};

jest.mock('../../../lib/supabase', () => {
  const mockUpdate = jest.fn();

  function mockBuilder(table: string) {
    let single = false;
    let updatePayload: any = null;
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => {
        if (updatePayload) mockUpdate(table, updatePayload, col, val);
        return chain;
      },
      neq: () => chain,
      in: () => chain,
      is: () => chain,
      not: () => chain,
      filter: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      range: () => chain,
      single: () => { single = true; return chain; },
      maybeSingle: () => { single = true; return chain; },
      insert: () => chain,
      update: (payload: any) => { updatePayload = payload; return chain; },
      delete: () => chain,
      then: (resolve: (v: any) => void) => {
        if (table === 'users') {
          resolve(single ? { data: USERS_ROW, error: null } : { data: [USERS_ROW], error: null, count: 1 });
        } else {
          // capsule_members / friendships count queries — no rows needed.
          resolve({ data: [], error: null, count: 0 });
        }
      },
    };
    return chain;
  }

  return {
    supabase: {
      from: mockBuilder,
      auth: {
        signOut: jest.fn(() => Promise.resolve({ error: null })),
        getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
      storage: {
        from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }),
      },
    },
    getFreshSession: jest.fn(() => Promise.resolve({ accessToken: 'test-token', userId: USER_ID })),
    __mockUpdate: mockUpdate,
  };
});

// Grab the spy the mock module stashed on itself (jest.mock factories can't
// close over out-of-scope non-`mock`-prefixed locals).
const { __mockUpdate: mockUpdate } = jest.requireMock('../../../lib/supabase');

describe('ProfileScreen sign-out', () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    (supabase.auth.signOut as jest.Mock).mockClear();
    sessionStore.set({ user: { id: USER_ID } } as any);
  });

  it('clears push_token for this user before signing out', async () => {
    await render(
      <AllProviders>
        <ProfileScreen />
      </AllProviders>,
    );

    const signOutBtn = await waitFor(() => screen.getByText('Sign Out'));
    await fireEvent.press(signOutBtn);

    // Confirm sheet's own destructive button (also labeled "Sign Out").
    const confirmButtons = await waitFor(() => screen.getAllByText('Sign Out'));
    await fireEvent.press(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(supabase.auth.signOut).toHaveBeenCalled());

    // The bug: push_token was never nulled anywhere in this flow.
    expect(mockUpdate).toHaveBeenCalledWith('users', { push_token: null }, 'id', USER_ID);

    // Order matters: the doc on clearPushToken explains why — the session
    // (and RLS authorization to write this user's own row) is gone once
    // signOut() resolves, so the clear must happen strictly before it.
    const updateCallOrder = mockUpdate.mock.invocationCallOrder[0];
    const signOutCallOrder = (supabase.auth.signOut as jest.Mock).mock.invocationCallOrder[0];
    expect(updateCallOrder).toBeLessThan(signOutCallOrder);
  });
});
