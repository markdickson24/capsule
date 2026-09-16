import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { AllProviders } from '../../../../test/renderWithProviders';
import { sessionStore } from '../../../lib/sessionStore';
import CapsuleDetailScreen from '../CapsuleDetailScreen';

// Tier 1 acceptance test: mount a REAL screen from src/ (not a toy component)
// that renders a media thumbnail grid, press a real thumbnail, and assert a
// real, observable state change (the full-screen media viewer becoming
// visible). This does not attempt to reproduce any bug — it exists purely to
// prove the harness (babel + jest-expo/ios preset + async RNTL 14 API +
// built-in matchers + the mocks in test/setup.ts) can mount and interact with
// this codebase's own components.

const CAPSULE_ID = 'c1';
const OWNER_ID = 'owner-1';

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

const MEDIA_ROWS = [
  {
    id: 'm1',
    storage_key: 'c1/m1.jpg',
    alt_storage_key: null,
    thumbnail_key: null,
    uploader_id: OWNER_ID,
    uploaded_at: '2025-06-01T00:00:00.000Z',
    media_type: 'photo',
    caption: null,
  },
  {
    id: 'm2',
    storage_key: 'c1/m2.jpg',
    alt_storage_key: null,
    thumbnail_key: null,
    uploader_id: OWNER_ID,
    uploaded_at: '2025-06-02T00:00:00.000Z',
    media_type: 'photo',
    caption: null,
  },
];

const TABLE_ROWS: Record<string, any[]> = {
  capsules: [CAPSULE_ROW],
  capsule_members: MEMBER_ROWS,
  media: MEDIA_ROWS,
  users: [{ id: OWNER_ID, subscription_tier: 'free' }],
  blocked_users: [],
  superlative_categories: [],
  reactions: [],
};

// jest's hoisting rule requires any out-of-scope identifier referenced inside
// a jest.mock factory to be prefixed `mock` — hence mockTableRows here rather
// than closing over TABLE_ROWS directly.
const mockTableRows = TABLE_ROWS;

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
        const rows = mockTableRows[table] ?? [];
        resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null });
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
          createSignedUrls: jest.fn((keys: string[]) =>
            Promise.resolve({
              data: keys.map((k) => ({ signedUrl: `https://example.com/signed/${k}` })),
              error: null,
            }),
          ),
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

function makeNavigation() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    isFocused: jest.fn(() => true),
  } as any;
}

describe('CapsuleDetailScreen (Tier 1 harness smoke test)', () => {
  beforeEach(() => {
    // sessionStore is a real module-level singleton — seed it directly rather
    // than mocking it, matching how the app itself sets it in useAuth.
    sessionStore.set({ user: { id: OWNER_ID } } as any);
  });

  it('mounts the real screen, renders the media grid, and opens the viewer on thumbnail press', async () => {
    await render(
      <AllProviders>
        <CapsuleDetailScreen
          route={{ key: 'CapsuleDetail', name: 'CapsuleDetail', params: { capsuleId: CAPSULE_ID } } as any}
          navigation={makeNavigation()}
        />
      </AllProviders>,
    );

    // The grid hydrated from the mocked `media` rows.
    const thumb0 = await waitFor(() => screen.getByTestId('capsule-thumb-0'));

    // Viewer is not open yet.
    expect(screen.queryByTestId('media-viewer')).toBeNull();

    await fireEvent.press(thumb0);

    // Pressing a thumbnail opens the full-screen MediaViewerModal — a real,
    // observable state change driven by the screen's own onPress handler.
    await waitFor(() => expect(screen.getByTestId('media-viewer')).toBeVisible());
  });
});
