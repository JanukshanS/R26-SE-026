/** Merged en catalogue. One file per namespace, flat dot-path keys. */
import common from "./common";
import landing from "./landing";
import portal from "./portal";
import signin from "./signin";
import app from "./app";
import claim from "./claim";
import report from "./report";
import provider from "./provider";
import garage from "./garage";
import garageModules from "./garageModules";
import me from "./me";
import parts from "./parts";
import ownerGarage from "./ownerGarage";
import shop from "./shop";
import shopFloor from "./shopFloor";
import shopPart from "./shopPart";
import shopPro from "./shopPro";
import home from "./home";
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
  ...claim,
  ...report,
  ...provider,
  ...garage,
  ...garageModules,
  ...me,
  ...parts,
  ...ownerGarage,
  ...shop,
  ...shopPro,
  ...shopPart,
  ...shopFloor,
  ...home,
  ...dashboard,
  ...insurer,
  ...admin,
  ...triage,
};

export default catalogue;
