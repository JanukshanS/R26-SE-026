import * as Lucide from "lucide-react-native";
import { type LucideProps } from "lucide-react-native";
import { palette } from "@theme/index";

type Internal = "default" | "createLucideIcon" | "Icon" | "icons";

export type IconName = Exclude<keyof typeof Lucide, Internal>;

type Props = LucideProps & {
  name: IconName;
};

export function Icon({ name, size = 22, color = palette.text, ...rest }: Props) {
  const Component = Lucide[name] as React.ComponentType<LucideProps>;
  if (!Component) return null;
  return <Component size={size} color={color} strokeWidth={2} {...rest} />;
}
