import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import LoadingBrand from './LoadingBrand';
import { useTheme } from '../context/ThemeContext';
import { haptics } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import { OccasionKey, PresetAward, pickDefaults, pickReplacement } from '../lib/awardPool';

const MAX_AWARDS = 4;

// Two modes, one shared presentational card:
//   'preview' — CreateScreen, before the capsule exists. Fully controlled —
//     the parent owns the `awards` array (seeded via pickDefaults) and this
//     component just calls onChange with the next array.
//   'manage'  — CapsuleDetailScreen, pre-unlock. This component owns its own
//     state: it fetches the capsule's current `is_default` categories on
//     mount, then every shuffle/swap/remove calls the set_default_superlatives
//     RPC (which does a full-replace) and updates local state on success.
type PreviewProps = {
  mode: 'preview';
  occasion: OccasionKey;
  awards: PresetAward[];
  onChange: (awards: PresetAward[]) => void;
};

type ManageProps = {
  mode: 'manage';
  capsuleId: string;
  occasion: OccasionKey;
};

type Props = PreviewProps | ManageProps;

export default function DefaultAwardsCard(props: Props) {
  const { accentColor } = useTheme();
  const isPreview = props.mode === 'preview';
  const capsuleId = !isPreview ? props.capsuleId : undefined;
  const occasion = props.occasion;

  const [manageAwards, setManageAwards] = useState<PresetAward[]>([]);
  const [loading, setLoading] = useState(!isPreview);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadManage = useCallback(async () => {
    if (isPreview || !capsuleId) return;
    setLoading(true);
    const { data } = await supabase
      .from('superlative_categories')
      .select('label, target_type')
      .eq('capsule_id', capsuleId)
      .eq('is_default', true)
      .order('created_at', { ascending: true });
    setManageAwards((data ?? []) as PresetAward[]);
    setLoading(false);
  }, [isPreview, capsuleId]);

  useEffect(() => {
    loadManage();
  }, [loadManage]);

  const awards = isPreview ? props.awards : manageAwards;

  async function commit(next: PresetAward[]) {
    if (isPreview) {
      props.onChange(next);
      return;
    }
    if (!capsuleId) return;
    const prev = manageAwards;
    setManageAwards(next);
    setSaving(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('set_default_superlatives', {
      p_capsule_id: capsuleId,
      p_awards: next,
    });
    setSaving(false);
    if (rpcError) {
      setManageAwards(prev);
      setError('Could not update awards. Try again.');
    }
  }

  function shuffleAll() {
    haptics.medium();
    commit(pickDefaults(occasion, MAX_AWARDS));
  }

  function swapOne(index: number) {
    haptics.light();
    const currentLabels = awards.map(a => a.label);
    const replacement = pickReplacement(occasion, currentLabels);
    commit(awards.map((a, i) => (i === index ? replacement : a)));
  }

  function removeOne(index: number) {
    haptics.light();
    commit(awards.filter((_, i) => i !== index));
  }

  if (loading) {
    return (
      <View style={styles.card}>
        <LoadingBrand size="small" color={accentColor} />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>{isPreview ? 'Suggested awards' : 'Default awards'}</Text>
          <Text style={styles.subtitle}>
            {isPreview
              ? 'Live the moment this capsule unlocks — members can suggest more too.'
              : 'Live the moment this capsule unlocks. Change them any time before then.'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.shuffleBtn, { borderColor: accentColor }, saving && styles.disabled]}
          onPress={shuffleAll}
          disabled={saving}
        >
          <Ionicons name="shuffle-outline" size={14} color={accentColor} />
          <Text style={[styles.shuffleText, { color: accentColor }]}>Shuffle all</Text>
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {awards.length === 0 ? (
        <Text style={styles.emptyText}>No default awards — tap "Shuffle all" to add some.</Text>
      ) : (
        <View style={styles.list}>
          {awards.map((a, i) => (
            <View key={`${a.label}-${i}`} style={[styles.chip, saving && styles.disabled]}>
              <Ionicons
                name={a.target_type === 'person' ? 'person-outline' : 'images-outline'}
                size={14}
                color="#888"
              />
              <Text style={styles.chipLabel} numberOfLines={1}>{a.label}</Text>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => swapOne(i)}
                disabled={saving}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Swap "${a.label}" for another award`}
              >
                <Ionicons name="refresh-outline" size={15} color="#888888" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => removeOne(i)}
                disabled={saving}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove "${a.label}" award`}
              >
                <Ionicons name="close" size={15} color="#888888" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    borderWidth: 1, borderColor: '#2A2A2A',
    paddingHorizontal: 16, paddingVertical: 14,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headerText: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 12, color: '#888888', marginTop: 3, lineHeight: 16 },
  shuffleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1,
  },
  shuffleText: { fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#FF3B30', fontSize: 12 },
  emptyText: { color: '#666666', fontSize: 13 },
  list: { gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#111111',
    borderRadius: 10, borderWidth: 1, borderColor: '#2A2A2A',
    paddingHorizontal: 12, paddingVertical: 9,
  },
  chipLabel: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  iconBtn: { padding: 2 },
});
