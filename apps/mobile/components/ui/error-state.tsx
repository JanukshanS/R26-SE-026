import { Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { palette, spacing, typography } from "@theme/index";

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Animated.View entering={FadeIn}>
      <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.danger, gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="TriangleAlert" size={20} color={palette.danger} />
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>{title}</Text>
        </View>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>{message}</Text>
        {onRetry && <Button title="Try again" onPress={onRetry} />}
      </Card>
    </Animated.View>
  );
}
