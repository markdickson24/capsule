import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { AllProviders } from '../../../../test/renderWithProviders';
import { sessionStore } from '../../../lib/sessionStore';
import { cache } from '../../../lib/cache';
import { toast } from '../../../lib/toast';
import NotificationsScreen from '../NotificationsScreen';

// Regression test for: declineInvite silently no-ops under RLS, permanently
// orphaning the pending invite (NotificationsScreen.tsx declineInvite).
//
// The capsule_members_delete RLS policy only allows the capsule OWNER to
// delete rows (supabase/migrations/20260515232500_capture_capsule_rls_and_helpers.sql:91-94).
// When the INVITEE taps Decline, the delete matches zero rows — Postgres/
// PostgREST report that as a normal, errorless response (zero rows affected,
// not a permission error). The current code only checks `error`, so it treats
// this zero-row "success" as a real decline: it marks the notification read,
// and the card is gone forever while the pending capsule_members row survives.
//
// This test simulates that exact RLS shape (delete resolves to
// { data: [], error: null }) and asserts the user-visible contract: a decline
// that didn't actually remove the membership must roll back the optimistic
// UI change and surface the existing error toast, not silently succeed.
//
// NOTE: every value the mock factory below closes over is prefixed `mock` —
// jest's babel hoisting of `jest.mock()` calls only reliably resolves
// out-of-scope references that follow this convention (see the identical
// note in CapsuleDetailScreen.smoke.test.tsx).

const mockUserId = 'invitee-1';
const mockCapsuleId = 'cap-1';
const mockMemberId = 'mem-1';
const mockNotifId = 'notif-1';

const mockNotifRow = {
  id: mockNotifId,
  capsule_id: mockCapsuleId,
  group_id: null,
  actor_id: null,
  type: 'invite',
  sent_at: '2026-09-01T00:00:00.000Z',
  read_at: null,
  count: null,
  capsules: { title: 'Trip' },
  groups: null,
  actor: null,
};

const mockPendingRow = { id: mockMemberId, capsule_id: mockCapsuleId };

jest.mock('../../../lib/supabase', () => {
  function mockBuilder(table: string) {
    let op: 'select' | 'delete' | 'update' = 'select';
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
      update: () => { op = 'update'; return chain; },
      delete: () => { op = 'delete'; return chain; },
      then: (resolve: (v: any) => void) => {
        if (table === 'capsule_members' && op === 'delete') {
          // Simulate the capsule_members_delete RLS policy: the invitee is
          // not the owner, so the DELETE matches zero rows. PostgREST
          // returns this as a clean, errorless response — never `error`.
          resolve({ data: [], error: null });
          return;
        }
        if (table === 'notifications') {
          resolve({ data: [mockNotifRow], error: null });
          return;
        }
        if (table === 'capsule_members') {
          resolve({ data: [mockPendingRow], error: null });
          return;
        }
        resolve(single ? { data: null, error: null } : { data: [], error: null });
      },
    };
    return chain;
  }

  return {
    supabase: {
      from: mockBuilder,
      auth: {
        getSession: jest.fn(() => Promise.resolve({ data: { session: null }, error: null })),
        getUser: jest.fn(() => Promise.resolve({ data: { user: null }, error: null })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      },
    },
    getFreshAccessToken: jest.fn(() => Promise.resolve('test-token')),
    getFreshSession: jest.fn(() => Promise.resolve({ accessToken: 'test-token', userId: mockUserId })),
  };
});

describe('NotificationsScreen declineInvite under RLS', () => {
  beforeEach(() => {
    cache.clear();
    toast.clear();
    sessionStore.set({ user: { id: mockUserId } } as any);
  });

  it('rolls back and shows an error toast when the delete matches zero rows (RLS-blocked)', async () => {
    await render(
      <AllProviders>
        <NotificationsScreen />
      </AllProviders>,
    );

    await waitFor(() => screen.getByText('Trip', { exact: false }));

    const declineBtn = await waitFor(() => screen.getByLabelText('Decline invite'));
    fireEvent.press(declineBtn);

    // A decline that didn't actually delete anything must not be treated as
    // success: the invite card should still be there (or come back) and the
    // user should be told it failed, exactly like the existing network-error
    // branch already does.
    await waitFor(() => {
      expect(toast.get()?.message).toBe("Couldn't decline the invite — try again.");
    });
    expect(screen.getByText('Trip', { exact: false })).toBeTruthy();
  });
});
