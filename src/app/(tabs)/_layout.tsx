import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { chatStore } from '@/lib/chat';
import { jobsStore } from '@/lib/jobs';
import { useStore } from '@/lib/store';
import { useTheme } from '@/theme';

/** System tab bar (Liquid Glass on iOS 26, Material navigation bar on Android). */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { jobs } = useStore(jobsStore);
  const { unreadTotal, escalatedCount } = useStore(chatStore);
  const toAccept = jobs.filter((j) => j.status === 'pending_acceptance').length;
  const chatBadge = unreadTotal + escalatedCount;

  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Jobs</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'printer', selected: 'printer.fill' }} md="print" />
        {toAccept > 0 ? <NativeTabs.Trigger.Badge>{toAccept > 9 ? '9+' : String(toAccept)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="orders">
        <NativeTabs.Trigger.Label>Orders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }} md="receipt_long" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="messages">
        <NativeTabs.Trigger.Label>Messages</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} md="chat" />
        {chatBadge > 0 ? <NativeTabs.Trigger.Badge>{chatBadge > 9 ? '9+' : String(chatBadge)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="shop">
        <NativeTabs.Trigger.Label>Shop</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'storefront', selected: 'storefront.fill' }} md="storefront" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
