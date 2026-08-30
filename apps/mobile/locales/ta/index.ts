/** Merged ta catalogue. One file per namespace, flat dot-path keys. */
import common from "./common";
import onboarding from "./onboarding";
import driver from "./driver";
import emergency from "./emergency";
import provider from "./provider";
import insurance from "./insurance";
import components from "./components";

const catalogue: Record<string, string> = {
  ...common,
  ...onboarding,
  ...driver,
  ...emergency,
  ...provider,
  ...insurance,
  ...components,
};

export default catalogue;
