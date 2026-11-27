/** Merged si catalogue. One file per namespace, flat dot-path keys. */
import common from "./common";
import landing from "./landing";
import portal from "./portal";
import signin from "./signin";
import app from "./app";
import report from "./report";
import provider from "./provider";
import garage from "./garage";
import garageModules from "./garageModules";
import me from "./me";
import dashboard from "./dashboard";
import insurer from "./insurer";
import admin from "./admin";
import triage from "./triage";

const catalogue: Record<string, string> = {
  ...common,
  ...landing,
  ...portal,
  ...signin,
  ...app,
  ...report,
  ...provider,
  ...garage,
  ...garageModules,
  ...me,
  ...dashboard,
  ...insurer,
  ...admin,
  ...triage,
};

export default catalogue;
