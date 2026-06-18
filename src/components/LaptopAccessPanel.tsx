import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { subscribeServer, startServer, stopServer, refreshServerIp, type ServerState } from '../server/localServer';

/**
 * "Laptop access (local network)" — toggles the LAN companion server so a laptop on
 * the same WiFi can open the phone's live dashboard. Shows the URL + PIN to type.
 */
export function LaptopAccessPanel() {
  const [srv, setSrv] = useState<ServerState>({ running: false, ip: null, port: 8088, pin: null, error: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeServer(setSrv), []);
  // Keep the shown address current — the phone's IP can change on the network while the server runs.
  useEffect(() => {
    if (!srv.running) return;
    void refreshServerIp();
    const t = setInterval(() => void refreshServerIp(), 8000);
    return () => clearInterval(t);
  }, [srv.running]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (srv.running) stopServer();
      else await startServer();
    } finally { setBusy(false); }
  };

  return (
    <View style={s.wrap}>
      <View style={s.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Laptop access (local network)</Text>
          <Text style={s.hint}>View & control LUCY from a laptop browser on the same WiFi. Nothing leaves your devices.</Text>
        </View>
        <TouchableOpacity
          onPress={() => void toggle()}
          disabled={busy}
          style={[s.pill, srv.running ? s.pillOn : s.pillOff]}
        >
          <Text style={[s.pillText, { color: srv.running ? LUCY_COLORS.primary : LUCY_COLORS.textMuted }]}>
            {busy ? '…' : srv.running ? 'On' : 'Off'}
          </Text>
        </TouchableOpacity>
      </View>

      {srv.running ? (
        <View style={s.info}>
          <Text style={s.infoLabel}>Open this on your laptop browser</Text>
          <Text style={s.url}>http://{srv.ip ?? '<phone-ip>'}:{srv.port}</Text>
          <Text style={s.note}>Same WiFi only · keep LUCY open. No PIN for now — anyone on this WiFi can access it.</Text>
          <Text style={s.trouble}>Can't connect? 1) Keep this app open + phone awake (iOS pauses the server when backgrounded). 2) Laptop on the SAME WiFi — turn OFF any VPN. 3) Use the exact address above (it changes between networks). 4) Office WiFi may block device-to-device — try your phone's hotspot.</Text>
        </View>
      ) : null}

      {srv.error ? <Text style={s.error}>{srv.error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  title: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700' },
  hint: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  pill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  pillOn: { backgroundColor: LUCY_COLORS.primarySoft, borderColor: LUCY_COLORS.primary },
  pillOff: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.border },
  pillText: { fontWeight: '800', fontSize: 12 },
  info: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, marginTop: 6 },
  infoLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 },
  url: { color: LUCY_COLORS.primary, fontSize: 18, fontWeight: '800', marginTop: 2 },
  pin: { color: LUCY_COLORS.textDark, fontSize: 26, fontWeight: '900', letterSpacing: 6, marginTop: 2 },
  note: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 10, lineHeight: 16 },
  trouble: { color: LUCY_COLORS.textMuted, fontSize: 11.5, marginTop: 8, lineHeight: 17 },
  error: { color: '#ff6b6b', fontSize: 13, marginTop: 6 },
});
