import React, { useEffect, useMemo, useState } from 'react';
import LoadingBrand from './LoadingBrand';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable,
  FlatList, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { sessionStore } from '../lib/sessionStore';
import { useTheme } from '../context/ThemeContext';
import { SuperlativeTargetType } from '../types/database';

export type VoteSheetMember = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

export type VoteSheetMedia = {
  id: string;
  mediaType: 'photo' | 'video';
  signedUrl: string;
  thumbnailUri?: string;
};

export type CurrentVote = {
  target_user_id: string | null;
  target_media_id: string | null;
};

type Props = {
  visible: boolean;
  category: {
    id: string;
    label: string;
    target_type: SuperlativeTargetType;
  } | null;
  members: VoteSheetMember[];
  media: VoteSheetMedia[];
  currentVote: CurrentVote | null;
  onClose: () => void;
  onSaved: () => void;
};

export default function VoteSheet({
  visible, category, members, media, currentVote, onClose, onSaved,
}: Props) {
  const { accentColor } = useTheme();
  const session = sessionStore.get();
  const userId = session?.user.id;

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible && category) {
      setSelectedUser(currentVote?.target_user_id ?? null);
      setSelectedMedia(currentVote?.target_media_id ?? null);
      setError('');
      setSaving(false);
      setRemoving(false);
    }
  }, [visible, category, currentVote]);

  const eligibleMembers = useMemo(
    () => members.filter(m => m.user_id !== userId),
    [members, userId],
  );

  if (!category) return null;

  const hadVote = currentVote !== null;
  const isPerson = category.target_type === 'person';
  const currentSelection = isPerson ? selectedUser : selectedMedia;
  const noChange =
    (isPerson && selectedUser === (currentVote?.target_user_id ?? null)) ||
    (!isPerson && selectedMedia === (currentVote?.target_media_id ?? null));
  const canSave = currentSelection !== null && !saving && !removing && !noChange;

  async function save() {
    if (!userId) return;
    if (!currentSelection) return;
    setSaving(true);
    setError('');

    const payload = {
      category_id: category!.id,
      voter_id: userId,
      target_user_id: isPerson ? selectedUser : null,
      target_media_id: isPerson ? null : selectedMedia,
    };

    const { error: upsertError } = await supabase
      .from('superlative_votes')
      .upsert(payload, { onConflict: 'category_id,voter_id' });

    setSaving(false);

    if (upsertError) {
      setError('Could not save your vote. Try again.');
      return;
    }

    onSaved();
    onClose();
  }

  async function removeVote() {
    if (!userId) return;
    setRemoving(true);
    setError('');

    const { error: deleteError } = await supabase
      .from('superlative_votes')
      .delete()
      .eq('category_id', category!.id)
      .eq('voter_id', userId);

    setRemoving(false);

    if (deleteError) {
      setError('Could not remove your vote. Try again.');
      return;
    }

    onSaved();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{category.label}</Text>
          <Text style={styles.subtitle}>
            {isPerson ? 'Pick who deserves it.' : 'Pick the winning photo or video.'}
          </Text>

          <View style={styles.body}>
            {isPerson ? (
              <PersonList
                members={eligibleMembers}
                selected={selectedUser}
                onSelect={setSelectedUser}
              />
            ) : (
              <MediaGrid
                media={media}
                selected={selectedMedia}
                onSelect={setSelectedMedia}
              />
            )}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: accentColor }, !canSave && styles.saveBtnDisabled]}
            onPress={save}
            disabled={!canSave}
          >
            {saving ? (
              <LoadingBrand size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.saveBtnText}>
                {hadVote ? 'Update vote' : 'Cast vote'}
              </Text>
            )}
          </TouchableOpacity>

          {hadVote && (
            <TouchableOpacity style={styles.removeBtn} onPress={removeVote} disabled={removing || saving}>
              {removing ? (
                <LoadingBrand size="small" color="#FF3B30" />
              ) : (
                <Text style={styles.removeText}>Remove my vote</Text>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PersonList({
  members, selected, onSelect,
}: {
  members: VoteSheetMember[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { accentColor } = useTheme();

  if (members.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="people-outline" size={28} color="#555" />
        <Text style={styles.emptyText}>No one to vote for yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 6 }}>
      {members.map(m => {
        const isSel = m.user_id === selected;
        return (
          <TouchableOpacity
            key={m.user_id}
            style={[styles.row, isSel && [styles.rowSelected, { borderColor: accentColor, backgroundColor: `${accentColor}22` }]]}
            onPress={() => onSelect(m.user_id)}
            activeOpacity={0.85}
          >
            <View style={[styles.avatarShell, { backgroundColor: `${accentColor}30` }]}>
              {m.avatar_url ? (
                <Image source={m.avatar_url} style={styles.avatarImg} contentFit="cover" />
              ) : (
                <Text style={[styles.avatarFallback, { color: accentColor }]}>
                  {(m.display_name || '?').slice(0, 1).toUpperCase()}
                </Text>
              )}
            </View>
            <Text style={styles.rowName}>{m.display_name || 'Member'}</Text>
            {isSel && <Ionicons name="checkmark-circle" size={20} color={accentColor} />}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

function MediaGrid({
  media, selected, onSelect,
}: {
  media: VoteSheetMedia[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { accentColor } = useTheme();

  if (media.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="images-outline" size={28} color="#555" />
        <Text style={styles.emptyText}>No media to vote on yet.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={media}
      numColumns={3}
      keyExtractor={item => item.id}
      style={{ maxHeight: 360 }}
      columnWrapperStyle={{ gap: 4 }}
      ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
      renderItem={({ item }) => {
        const isSel = item.id === selected;
        const src = item.mediaType === 'video' ? item.thumbnailUri : item.signedUrl;
        return (
          <TouchableOpacity
            style={[styles.tile, isSel && { borderColor: accentColor, borderWidth: 3 }]}
            onPress={() => onSelect(item.id)}
            activeOpacity={0.85}
          >
            {src ? (
              <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
            ) : (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: '#222' }]} />
            )}
            {item.mediaType === 'video' && (
              <View style={styles.videoBadge}>
                <Ionicons name="play" size={14} color="#FFFFFF" />
              </View>
            )}
            {isSel && (
              <View style={[styles.tileCheck, { backgroundColor: accentColor }]}>
                <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              </View>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, gap: 14,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#444', alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#FFFFFF' },
  subtitle: { fontSize: 14, color: '#888888' },
  body: { minHeight: 80 },
  empty: { paddingVertical: 28, alignItems: 'center', gap: 8 },
  emptyText: { color: '#888', fontSize: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1, borderColor: 'transparent',
    backgroundColor: '#111111',
  },
  rowSelected: { borderColor: '#FF6B35' },
  avatarShell: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { fontSize: 14, fontWeight: '800' },
  rowName: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  tile: {
    flex: 1, aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#111',
    borderWidth: 0, borderColor: 'transparent',
  },
  videoBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10, paddingHorizontal: 5, paddingVertical: 3,
  },
  tileCheck: {
    position: 'absolute', bottom: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  error: { color: '#FF3B30', fontSize: 13, textAlign: 'center' },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 15, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  removeBtn: { paddingVertical: 10, alignItems: 'center' },
  removeText: { color: '#FF3B30', fontWeight: '600', fontSize: 14 },
  cancelBtn: { paddingVertical: 10, alignItems: 'center' },
  cancelText: { color: '#888', fontWeight: '600', fontSize: 14 },
});
