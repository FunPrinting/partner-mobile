import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { JobCard } from '@/components/JobCard';
import { Banner, Body, Button, Card, EmptyState, Pill, Screen, Section } from '@/components/ui';
import { connectionStore } from '@/lib/connection';
import { groupJobs } from '@/lib/jobLogic';
import { jobAction, jobsStore, syncJobs } from '@/lib/jobs';
import { stationStore } from '@/lib/printStation';
import { sessionStore } from '@/lib/session';
import { settingsStore } from '@/lib/settings';
import { useStore } from '@/lib/store';
import { space, type, useTheme } from '@/theme';

function StatusCard() {
  const { colors } = useTheme();
  const { connected } = useStore(connectionStore);
  const settings = useStore(settingsStore);
  const station = useStore(stationStore);
  const { lastSyncAt } = useStore(jobsStore);
  const isStation = settings.mode === 'station';
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ gap: 2, flex: 1 }}>
          <Text style={[type.headline, { color: colors.text }]}>{isStation ? 'Print station' : 'Companion'}</Text>
          <Body tone="tertiary">
            {isStation
              ? settings.printer
                ? `Prints on ${settings.printer.kind === 'dialog' ? 'any printer (you confirm each file)' : settings.printer.name} while this app is open`
                : 'Choose a printer in Settings to start'
              : 'Orders print on your shop computer'}
          </Body>
        </View>
        <Pill label={connected ? 'Live' : 'Offline'} tone={connected ? 'success' : 'neutral'} />
      </View>
      {station.current ? (
        <View style={{ gap: space.xs }}>
          <Text style={[type.callout, { color: colors.text }]}>
            Printing {station.current.label} · file {station.current.file} of {station.current.files}
          </Text>
          <Body tone="tertiary">{station.current.status}</Body>
        </View>
      ) : null}
      {lastSyncAt ? <Text style={[type.caption, { color: colors.textTertiary }]}>Updated {new Date(lastSyncAt).toLocaleTimeString()}</Text> : null}
    </Card>
  );
}

export default function JobsScreen() {
  const { jobs, loaded, error } = useStore(jobsStore);
  const { deviceId } = useStore(sessionStore);
  const settings = useStore(settingsStore);
  const station = useStore(stationStore);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const groups = groupJobs(jobs, deviceId);

  const onRefresh = async () => {
    setRefreshing(true);
    await syncJobs();
    setRefreshing(false);
  };

  const act = async (jobId: string, action: 'accept' | 'reject', reason?: string) => {
    setBusy(jobId);
    const result = await jobAction(jobId, action, reason);
    setBusy(null);
    if (!result.ok) Alert.alert(action === 'accept' ? 'Could not accept' : 'Could not decline', result.error);
  };

  const decline = (jobId: string) => {
    Alert.alert('Decline this order?', 'The customer is refunded straight away.', [
      { text: 'Keep order', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => act(jobId, 'reject') },
    ]);
  };

  const empty = loaded && !jobs.length;

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <StatusCard />
      {error ? <Banner tone="warning" title="Can't reach FunPrinting" message={`${error}. Pull down to try again.`} /> : null}
      {station.lastError && station.cooldownUntil ? (
        <Banner tone="danger" title="The last print failed" message={`${station.lastError}. The order went back to your queue; the next one starts in 2 minutes.`} />
      ) : null}
      {station.pendingReports ? <Banner tone="info" title={`${station.pendingReports} finished job(s) will be reported when you are back online`} /> : null}
      {settings.mode === 'station' && !settings.printer ? (
        <Banner tone="info" title="No printer chosen" message="This phone is a print station but has no printer yet." action={<Button variant="plain" title="Choose a printer" onPress={() => router.navigate('/settings')} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />} />
      ) : null}

      {groups.pending.length ? (
        <Section title="Needs your OK">
          {groups.pending.map((j) => (
            <JobCard key={j.jobId} job={j} tone="warning" badge="To accept">
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button title="Decline" variant="destructive" onPress={() => decline(j.jobId)} disabled={busy === j.jobId} style={{ flex: 1 }} />
                <Button title="Accept" onPress={() => act(j.jobId, 'accept')} loading={busy === j.jobId} style={{ flex: 1 }} />
              </View>
            </JobCard>
          ))}
        </Section>
      ) : null}

      {groups.mine.length ? (
        <Section title="Printing on this phone">
          {groups.mine.map((j) => (
            <JobCard key={j.jobId} job={j} tone="primary" badge="Printing here" />
          ))}
        </Section>
      ) : null}

      {groups.waiting.length ? (
        <Section title="Waiting to print" footer={settings.mode === 'companion' ? 'Your desktop app prints these. Switch this phone to a print station in Settings to print here.' : undefined}>
          {groups.waiting.map((j) => (
            <JobCard key={j.jobId} job={j} tone={j.status === 'failed' ? 'danger' : 'neutral'} badge={j.status === 'failed' ? 'Retry' : 'Waiting'} note={settings.mode === 'station' ? station.skipped[j.jobId] : undefined} />
          ))}
        </Section>
      ) : null}

      {groups.elsewhere.length ? (
        <Section title="On another device">
          {groups.elsewhere.map((j) => (
            <JobCard key={j.jobId} job={j} tone="info" badge="Printing" />
          ))}
        </Section>
      ) : null}

      {empty ? (
        <EmptyState
          icon={{ ios: 'tray', android: 'inbox' }}
          title="No print jobs"
          message="New paid orders appear here straight away. Keep your shop online in the Shop tab to receive them."
        />
      ) : null}
    </Screen>
  );
}
