import { Text, View } from 'react-native';
import { fileSummary, minutesLeft, type Job } from '@/lib/jobLogic';
import { space, type, useTheme, type Tone } from '@/theme';
import { Card, Pill } from './ui';

function timeAgo(iso?: string) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function JobCard({ job, tone, badge, note, children }: { job: Job; tone: Tone; badge: string; note?: string; children?: React.ReactNode }) {
  const { colors } = useTheme();
  const first = job.files?.[0];
  const more = (job.files?.length ?? 0) - 1;
  const deadline = job.status === 'pending_acceptance' ? minutesLeft(job.acceptBy) : null;
  const label = `Order ${job.deliveryNumber || job.orderId}, ${badge}`;
  return (
    <Card tone={tone}>
      <View accessible accessibilityLabel={label} style={{ gap: space.xs }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
          <Text style={[type.headline, { color: colors.text }]}>#{job.deliveryNumber || job.orderId}</Text>
          <Pill label={badge} tone={tone} />
          <Text style={[type.footnote, { color: colors.textTertiary }]}>
            {job.deliveryType === 'delivery' ? 'Delivery' : 'Pickup'} · {timeAgo(job.createdAt)}
          </Text>
        </View>
        {first ? (
          <>
            <Text style={[type.callout, { color: colors.text }]} numberOfLines={1}>
              {first.name}
              {more > 0 ? `  +${more} more` : ''}
            </Text>
            <Text style={[type.footnote, { color: colors.textTertiary }]}>{fileSummary(first)}</Text>
          </>
        ) : null}
        {deadline !== null ? (
          <Text style={[type.footnote, { color: colors.warning }]}>
            {deadline > 0 ? `Accept within ${deadline} min, or the customer is offered a refund.` : 'The customer has been offered a refund. You can still accept.'}
          </Text>
        ) : null}
        {job.lastError ? <Text style={[type.footnote, { color: colors.danger }]}>{job.lastError}</Text> : null}
        {note ? <Text style={[type.footnote, { color: colors.textTertiary }]}>{note}</Text> : null}
      </View>
      {children}
    </Card>
  );
}
