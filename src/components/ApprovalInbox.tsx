/**
 * ApprovalInbox — the review cards that greet the user when they open the app.
 *
 * On launch, if there are open context questions OR memory-update proposals, this raises a modal
 * presenting them in the swipeable ReviewCardDeck (via NeedsContextView). The user can act on them
 * or tap "Not now" — deferred items stay open and reappear next visit (they're persisted), nothing
 * is forced or lost. Shown at most once per app foreground so it never nags.
 */
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listOpenContextRequests, type ContextRequestRow } from '../db/contextRequests';
import { NeedsContextView } from '../screens/Dashboard';

export function ApprovalInbox({ trigger }: { trigger: number }) {
  const [visible, setVisible] = useState(false);
  const [requests, setRequests] = useState<ContextRequestRow[]>([]);

  const reload = async () => {
    try {
      const db = await getDatabase();
      const [reqs, proposals] = await Promise.all([
        listOpenContextRequests(db),
        import('../db/memoryUpdateProposals').then(({ listOpenMemoryUpdateProposals }) => listOpenMemoryUpdateProposals(db)),
      ]);
      setRequests(reqs);
      return reqs.length + proposals.length;
    } catch { return 0; }
  };

  useEffect(() => {
    if (trigger <= 0) return;
    void (async () => {
      const count = await reload();
      if (count > 0) setVisible(true);
    })();
  }, [trigger]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)} presentationStyle="fullScreen">
      <View style={styles.wrap}>
        <View style={styles.head}>
          <View>
            <Text style={styles.kicker}>WHILE YOU WERE AWAY</Text>
            <Text style={styles.title}>A few things to review</Text>
          </View>
          <TouchableOpacity style={styles.notNow} onPress={() => setVisible(false)}>
            <Text style={styles.notNowText}>Not now</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1 }}>
          <NeedsContextView
            requests={requests}
            onAnswered={() => { void reload().then((c) => { if (c === 0) setVisible(false); }); }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: LUCY_COLORS.surface, paddingTop: 54 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 6 },
  kicker: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '800', marginTop: 4 },
  notNow: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised },
  notNowText: { color: LUCY_COLORS.textMuted, fontWeight: '700', fontSize: 14 },
});
