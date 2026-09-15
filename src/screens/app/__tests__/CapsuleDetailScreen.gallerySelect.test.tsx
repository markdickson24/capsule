import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { AllProviders } from '../../../../test/renderWithProviders';
import { sessionStore } from '../../../lib/sessionStore';
import CapsuleDetailScreen from '../CapsuleDetailScreen';

// Regression test for: tapping a thumbnail inside MediaGalleryModal ("See all
// N") never presented the full-screen viewer, because the gallery Modal was
// left mounted (`visible={showGallery}` still true) at the same time the
// MediaViewerModal Modal was mounted as a sibling — two simultaneous native
// Modal presentations, which iOS refuses (see CapsuleDetailScreen.tsx's
// MediaGalleryModal onSelect wiring + the parent's onSelect={(index) =>
// setActiveMediaIndex(index)} with no setShowGallery(false)).
//
// react-native's own jest mock for Modal (node_modules/react-native/jest/mocks/Modal.js)
// renders null when `visible === false`, so this is directly observable here:
// selecting a gallery thumbnail must close the gallery (its Modal unmounts)
// at the same time the viewer opens.

const CAPSULE_ID = 'c1';
const OWNER_ID = 'owner-1';

const CAPSULE_ROW = {
  id: CAPSULE_ID,
  owner_id: OWNER_ID,
  title: 'Trip',
  description: '',
  status: 'unlocked',
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

// >3 items so the "See all N" gallery entry point renders.
const MEDIA_ROWS = [1, 2, 3, 4].map((n) => ({
  id: `m${n}`,
  storage_key: `c1/m${n}.jpg`,
  alt_storage_key: null,
  thumbnail_key: null,
  uploader_id: OWNER_ID,
  uploaded_at: `2025-06-0${n}T00:00:00.000Z`,
  media_type: 'photo',
  caption: null,
}));

const TABLE_ROWS: Record<string, any[]> = {
  capsules: [CAPSULE_ROW],
  capsule_members: MEMBER_ROWS,
  media: MEDIA_ROWS,
  users: [{ id: OWNER_ID, subscription_tier: 'free' }],
  blocked_users: [],
  superlative_categories: [],
  reactions: [],
};

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

describe('CapsuleDetailScreen gallery -> viewer handoff', () => {
  beforeEach(() => {
    sessionStore.set({ user: { id: OWNER_ID } } as any);
  });

  it('closes the gallery modal when a thumbnail is selected, so the viewer is not a stacked sibling presentation', async () => {
    await render(
      <AllProviders>
        <CapsuleDetailScreen
          route={{ key: 'CapsuleDetail', name: 'CapsuleDetail', params: { capsuleId: CAPSULE_ID } } as any}
          navigation={makeNavigation()}
        />
      </AllProviders>,
    );

    const seeAllBtn = await waitFor(() => screen.getByText('See all 4'));
    await fireEvent.press(seeAllBtn);

    const galleryThumb0 = await waitFor(() => screen.getByTestId('gallery-thumb-0'));
    await fireEvent.press(galleryThumb0);

    // The viewer should open...
    await waitFor(() => expect(screen.getByTestId('media-viewer')).toBeVisible());

    // ...and the gallery must have closed (its Modal unmounts when
    // visible={false}, per react-native's own jest Modal mock) rather than
    // staying mounted as a second, sibling presentation.
    expect(screen.queryByTestId('media-gallery')).toBeNull();
  });
});
