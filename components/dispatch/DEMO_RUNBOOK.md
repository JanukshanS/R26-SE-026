# The P0480 Runbook — two-phone dispatch demo

One set of symptoms, run twice. Without the OBD tier the model calls it a **severe overheat**.
With the tier — and one stored trouble code — it calls it a **dead radiator fan**: a
different fault, a different job, and a third off the expected cost.

Every number below came out of the real triage engine and the real ECM, scored against the live
provider table with Google Distance Matrix supplying travel times. Re-derived 2026-08-31.

---

## 1. What is running

| Service | URL | What it is |
| --- | --- | --- |
| Dispatch API | `http://localhost:3001` | Triage + ECM + the 120 s re-dispatch watchdog. Health at `/health`. |
| Metro — Kaduna app | `http://localhost:8081` | Phone A, and phone B when it plays the provider. |
| Metro — OBD simulator | `http://localhost:8082` | Phone B during the OBD run. |
| Kaduna app on web | `http://localhost:8090` | Browser fallback for the provider end. No Bluetooth here. |
| Ops dashboard | `http://localhost:3000` | Next.js web app. |
| geo-intelligence | `https://geo.vps.kaduna.lk` | Not local — dispatch calls Asath's VPS, which is what its `.env` already points at. |

**The phones reach all of this over the USB cable, not Wi-Fi.** `apps/mobile/.env` now points at
`http://localhost:3001` and `scripts/demo-phones.sh` sets up the `adb reverse` tunnels. Shared
Wi-Fi isolates clients from each other often enough that the LAN route is not worth the risk
mid-demo. One consequence: *this value is wrong for a production build* — swap it for a reachable
host before building.

---

## 2. Setting up the two phones

1. **Plug both phones in and run the rig script.**

   ```bash
   bash scripts/demo-phones.sh
   ```

   It finds each phone by which app is installed, opens the tunnels it needs, and launches it
   straight against the right bundler. Re-run it any time a phone shows "Failed to connect to
   localhost" — reverse tunnels drop silently and re-running is the fix.

2. **Sign in on phone A as the driver.** Use `sjanukshan9825@gmail.com` — "Janukshan Sivakumar",
   role `driver`, no provider linked.

   **Not** `janukshansivakumar07@gmail.com`. It is also named Janukshan Sivakumar, but its profile
   carries a `provider_id` pointing at a provider row that no longer exists, so provider calls made
   under it will fail.

3. **Register the provider on phone B, then give it both cooling services.** Register a fresh
   account on the provider side (any type). It takes the phone's GPS, so it lands beside the
   driver. Then open **Services** and make sure both **ENGINE_OVERHEAT_SEVERE** and
   **RADIATOR_FAN_ISSUE** are ticked.

   The Services list, not the type, is what dispatch actually matches on. `type` only seeds the
   defaults at registration — a provider may add any real service type afterwards, by design
   (`getAllServiceTypes()`). So one account covers both runs whatever you registered it as, and
   without both services ticked it is ineligible for one of them and will not be offered the job.

   This is how `New Malabe Auto` is set up in the database now: a MOBILE_MECHANIC with
   ENGINE_OVERHEAT_SEVERE added, which is why it ranks #1 in both runs below.

4. **Pair the simulator's adapter in Android Bluetooth settings.** On phone B, start the OBD
   simulator once and let it advertise as `KADUNA-OBDII`; on phone A, pair that name in the system
   Bluetooth settings. The app can only connect to an adapter the OS already knows. Do this before
   the audience is watching.

---

## 3. The questionnaire, both runs

Identical taps each time. The *only* difference between the two runs is whether phone A has an OBD
adapter paired when it reaches the last question.

| Screen | Pick |
| --- | --- |
| Safety check | No Visible Damage |
| What's wrong? | Engine trouble |
| Step 1 · Engine | Starts but runs rough |
| Step 2 · Lights | Temp — *that lamp only* |
| Step 3 · Recent | Temperature gauge went up |
| Step 4 · Running | Overheating |
| Step 5 · Smell | Sweet smell |
| Step 6 · Overheat | Even when driving normally |

> Steps 4 and 5 swapped when the model was retrained: `Q2b_running_issue` went
> from 7.2% to 11.6% of the tree's routing weight and now outranks
> `Q6_smells`. The questionnaire is ordered by measured weight, so the retrain
> reordered it.

Tapping **Next** on step 6 is what fires the triage call — it reads the OBD adapter first, if one
is connected, then posts the answers. There is no separate "Get Diagnosis" screen any more.

**Do not improvise the smell answer.** "Sweet smell" is load-bearing: it is what keeps Tier 1 on
ENGINE_OVERHEAT_SEVERE and out of the fan, which is the whole contrast (see §6). The overheat
detail on step 6 is safer — "Even when driving normally" and "Only in heavy traffic" both leave
Tier 1 on the overheat — but re-check any answer you change, because the 450-combination sweep
that backed this claim was run against the pre-retrain model.

---

## 4. Run one — without the OBD tier

Phone A must have **no adapter paired**. If it is still connected from an earlier run, unpair it on
the home screen first — the app never quietly falls back to synthetic data, so unpaired genuinely
means Tier 1.

Walk the questionnaire. On the result screen, `MODEL` reads **Tier-1**. Then hand phone B the job
and accept it there.

---

## 5. Run two — with the OBD tier

1. **On phone B, load the fault.** Open the OBD simulator, tap **Select Scenario** and choose
   **Engine overheating**. The new *Fault Memory* card should now read `P0480` · confirmed, with
   **MIL On**. That card is worth showing the examiner — it is the ECU's own conclusion, and it is
   what the next two minutes turn on.

2. **Start the engine — genuinely required.** Tap **Ignition Start**. The ECU sits on the switched
   supply, so with the ignition off it answers mode 03 with nothing, exactly as a real car does.
   Codes can only be read key-on. The simulator will tell you so under the card if you forget.

3. **On phone A, pair the adapter.** Home screen → **Connect OBD-II** → wait for "Connected!",
   naming `KADUNA-OBDII` over *classic* Bluetooth. Classic is the only transport with a code
   reader, and it is the one the simulator speaks.

4. **Walk the same questionnaire.** On the result screen `MODEL` now reads **Tier-2 (OBD
   enhanced)** and the diagnosis has changed. Dispatch's own log line carries the proof —
   `faultCodes: ["P0480"]` alongside `predictionBeforeCodes`, which still says the overheat.

   ```bash
   # worth having open on the projector
   tail -f .dev-logs/dispatch.log
   ```

5. **Accept on the provider end.** The Bluetooth link has done its job by now, so phone B can
   switch over to the Kaduna app and accept the job. If switching apps mid-demo feels
   risky, take the provider end in a browser at `localhost:8090` instead.

**Accept within two minutes.** `DISPATCH_TIMEOUT_SECONDS` is 120, and the re-dispatch watchdog
polls every 15 s. Leave a job sitting and it will be pulled back and offered to someone else —
which is a fine thing to demonstrate on purpose, and an awkward thing to discover by accident.

---

## 6. What you should see

| | Run one — no adapter | Run two — adapter paired |
| --- | --- | --- |
| Model | Tier-1 · questionnaire only | Tier-2 · OBD enhanced |
| Codes | none read | `P0480` confirmed · MIL on |
| Diagnosis | **ENGINE_OVERHEAT_SEVERE** (100%) | **RADIATOR_FAN_ISSUE** (55%) |
| Full distribution | overheat 100% | fan 55% · overheat 36% · coolant 9% |
| Entropy | 0.00 | 0.91 |
| Expected cost (rank 1) | 160.7 | 94.0 |

Add the middle step if you want it: **Tier 2 with the adapter paired but the
engine off**, so no codes are read. That gives ENGINE_OVERHEAT_SEVERE at 83%
(overheat 80% / coolant 20%), cost 132.0 — the sensors alone sharpen nothing
about the cause. Then start the engine and re-run to bring the code in.

**The sensors alone do not name the cause.** With the adapter paired but no codes read, Tier 2
still says ENGINE_OVERHEAT_SEVERE — it only softens from 100% to 83% and adds COOLANT_LOW at 20%.
Coolant at 117 °C confirms the symptom the driver already described. Only the stored code moves
the answer to a different fault. That is the sharpest thing this demo says, and it is worth
saying out loud.

**Be careful how you describe the Tier-1 100%.** It is leaf purity on a decision tree, not a
calibrated probability. After the `min_samples_leaf=5` retrain, 41% of Tier-1 leaves are still
one-hot (down from 96%) and this path happens to land on one of them. The honest line is *"that
figure is the tree's leaf purity; our reliability analysis puts Tier-1 ECE at 0.14, which is why
the OBD tier exists"* — do not present it as the model being certain.

**Why the confidence FALLS from 100% to 55%.** Because the evidence became contradictory, not
because the diagnosis got worse. Entropy rises 0.00 → 0.91. The 55/45 split is also arithmetic
rather than a learned number: `STRENGTH_WEIGHT.strong` is 0.55, so a confirmed code contradicting
a confident tree always lands near there. Say that before an examiner finds it.

**Why the questionnaire never suspects the fan.** The demo answers include *sweet smell*, which
the UI itself labels "coolant leak (antifreeze)". In the training data, OVERHEATING + ALWAYS +
SWEET contains **zero** RADIATOR_FAN_ISSUE rows — it is 8 hose-leak and 8 severe-overheat. So a
correctly calibrated model *should not* rank the fan second here, and the code is carrying
information the questionnaire genuinely does not have. Answer NO_SMELL instead and Tier 1 puts
the fan joint-first on its own — which removes the contrast the demo is built on.

---

## 7. The code had to be added

The simulator had no fault codes at all. It answered mode 03 with `?`, which Kaduna records as
"could not ask" and discards — so no preset could ever have exercised the trouble-code path, and
the OBD half of this demo was not possible before today. Fixed in `obd-ii-simulator` commit
`97b26ef`:

- Modes **03** and **07** answer properly, and a healthy car answers `NO DATA` rather than `?` — a
  *successful* read of an empty fault memory, which is what lets dispatch tell a clean car apart
  from one it failed to interrogate.
- Mode 01 PID 01 carries the lamp state and the stored count.
- **Engine overheating** now stores `P0480`; **Failing battery** stores `P0562`.
- Fault memory clears when you switch preset — every other property of the car carries over
  mid-trip by design, but codes describe which fault the car *has*.
- 13 new tests drive Kaduna's real `scanDtcs` against the responder, so the two sides cannot drift
  apart silently. Full suite: 53 passing.

**Why P0480 and not P0217.** P0217 is literally "engine overheating" — the symptom the driver
already reported. P0480 is the cooling-fan circuit: the cause, and the thing a mechanic would
actually be sent to replace. Pairing the two would split the code evidence between them and land
back on the tow, which is why the preset carries only the fan code.

---

## 7b. The model behind these numbers

Retrained on 2026-08-31 with `min_samples_leaf=5` (was 1, i.e. fully unpruned).

| | before | after |
| --- | --- | --- |
| Tier-1 leaves | 213 (depth 19) | 102 (depth 16) |
| Tier-1 one-hot leaves | 96% | 41% |
| Tier-1 ECE (10-bin) | 0.362 | **0.142** |
| Tier-1 Brier | 0.718 | 0.602 |
| Tier-1 accuracy | 0.644 | 0.575 |
| Tier-2 ECE | 0.310 | **0.136** |
| Tier-2 accuracy | 0.690 | **0.713** |

Tier-1 accuracy fell ~7pp on an 87-row test set (about six cases, within noise), while calibration
error more than halved and Tier 2 improved on both counts. The point of the change was that a tree
reporting 100% on nearly every input cannot support any claim about confidence — which is exactly
the question an examiner asks first.

`calibration_eval_v3.py` had `min_samples_leaf` hardcoded to 1 while `train_v3.py` exposed it as a
flag, so it silently measured a different model from the deployed one. It now takes the flag; pass
the same value used for the trees.

---

## 8. If something goes sideways

| Symptom | Cause and fix |
| --- | --- |
| Result says Tier-1 on the OBD run | The adapter dropped, so no telemetry reached the payload. Re-pair from the home screen. The app will not silently substitute synthetic data — that is why this shows up honestly. |
| Tier-2, but the diagnosis is still the overheat | The codes did not come back. Almost always the ignition: mode 03 needs the engine running on phone B. |
| Phone shows "Failed to connect to localhost" | A reverse tunnel dropped. Re-run `scripts/demo-phones.sh`. |
| Phone B's simulator has no Fault Memory card | It is running the standalone production APK, not the dev client, so it never loaded today's Metro bundle. Reinstall the dev client build and relaunch through the script. |
| Job vanishes from the provider screen | The 120 s watchdog reclaimed it and offered it elsewhere. Start a fresh incident. |
| "Couldn't reach the diagnosis service" | Dispatch is down or untunnelled. Check `curl http://127.0.0.1:3001/health` — use the literal IP, since `localhost` resolves to IPv6 first on this machine and hangs. |
