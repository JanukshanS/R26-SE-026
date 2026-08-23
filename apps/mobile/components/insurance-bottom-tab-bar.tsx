import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type InsuranceTabId = 'home' | 'tools' | 'store' | 'profile';

type SecondaryTab = {
  id: Exclude<InsuranceTabId, 'home'>;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  /** Tools has no screen yet, so it renders dimmed and inert rather than alerting on tap. */
  available: boolean;
};

const SECONDARY_TABS: SecondaryTab[] = [
  { id: 'tools', icon: 'construct-outline', label: 'Tools', available: false },
  { id: 'store', icon: 'storefront-outline', label: 'Store', available: true },
  { id: 'profile', icon: 'person-outline', label: 'Profile', available: true },
];

const COLORS = {
  screen: '#ffffff',
  border: '#e0e0e0',
  tabActive: '#ff6b35',
  tabInactive: '#9e9e9e',
};

type InsuranceBottomTabBarProps = {
  onTabPress: (tab: InsuranceTabId) => void;
};

export function InsuranceBottomTabBar({ onTabPress }: InsuranceBottomTabBarProps) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.tabSafe}>
      <View style={styles.tabBar}>
        <Pressable
          style={styles.tabItem}
          onPress={() => onTabPress('home')}
          accessibilityRole="tab"
          accessibilityLabel="Home"
          accessibilityState={{ selected: true }}>
          <View style={[styles.tabIconCircle, styles.tabIconCircleActive]}>
            <Ionicons name="home" size={22} color="#fff" />
          </View>
        </Pressable>
        {SECONDARY_TABS.map((tab) =>
          tab.available ? (
            <Pressable
              key={tab.id}
              style={styles.tabItem}
              onPress={() => onTabPress(tab.id)}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}>
              <Ionicons name={tab.icon} size={26} color={COLORS.tabInactive} />
            </Pressable>
          ) : (
            <View
              key={tab.id}
              style={[styles.tabItem, styles.tabItemUnavailable]}
              accessibilityRole="tab"
              accessibilityLabel={`${tab.label}, not available yet`}
              accessibilityState={{ disabled: true }}>
              <Ionicons name={tab.icon} size={26} color={COLORS.tabInactive} />
            </View>
          ),
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tabSafe: {
    backgroundColor: COLORS.screen,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: COLORS.screen,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  tabItem: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
  },
  tabItemUnavailable: {
    opacity: 0.4,
  },
  tabIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconCircleActive: {
    backgroundColor: COLORS.tabActive,
  },
});
