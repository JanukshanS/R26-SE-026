import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export type InsuranceTabId = 'home' | 'tools' | 'store' | 'profile';

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
          accessibilityState={{ selected: true }}>
          <View style={[styles.tabIconCircle, styles.tabIconCircleActive]}>
            <Ionicons name="home" size={22} color="#fff" />
          </View>
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => onTabPress('tools')} accessibilityRole="tab">
          <Ionicons name="construct-outline" size={26} color={COLORS.tabInactive} />
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => onTabPress('store')} accessibilityRole="tab">
          <Ionicons name="storefront-outline" size={26} color={COLORS.tabInactive} />
        </Pressable>
        <Pressable style={styles.tabItem} onPress={() => onTabPress('profile')} accessibilityRole="tab">
          <Ionicons name="person-outline" size={26} color={COLORS.tabInactive} />
        </Pressable>
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
