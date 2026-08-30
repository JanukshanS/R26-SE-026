# The P0480 Runbook — two-phone dispatch demo

One set of symptoms, run twice. Without the OBD tier the model calls it a **severe overheat**
and books a tow. With the tier — and one stored trouble code — it calls it a **dead radiator
fan** and books a roadside repair.

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

3. **Register the provider on phone B as a *light tow truck*.** Open the Kaduna app on phone B, go
   to the provider side, register a fresh account and pick **Tow (light)**. It takes the phone's
   GPS, so it lands beside the driver and wins both runs outright.

   The type matters more than it looks. A mobile mechanic *cannot* be sent a severe overheat at
   all, and even after the fan code lands it still loses to a tow (see §6). A light tow can service
   both diagnoses, so one account covers the whole demo.

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
| Step 4 · Smell | Sweet smell |
| Step 5 · Running | Overheating |
| Step 6 · Overheat | Even when driving normally |

Tapping **Next** on step 6 is what fires the triage call — it reads the OBD adapter first, if one
is connected, then posts the answers. There is no separate "Get Diagnosis" screen any more.

**The overheat answer is not load-bearing.** All three of "Even when driving normally", "Only in
heavy traffic" and "Only when climbing hills" produce the same pair of outcomes, so a mis-tap under
pressure costs nothing. Verified across 450 combinations of the sensor values the simulator
actually produces.

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
   switch over to the Kaduna app and accept as the tow provider. If switching apps mid-demo feels
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
| Eligible providers | tow trucks only | mechanics and tows |
| Expected cost | 163.4 | 108.4 |
| Rank 1 | phone B | phone B |

**The sensors alone changed nothing.** Running Tier 2 with live telemetry but *no* codes still
returns ENGINE_OVERHEAT_SEVERE at 100%. Coolant at 117 °C confirms the symptom the driver already
described; only the stored code names a cause. That is the single sharpest thing this demo says,
and it is worth saying out loud.

**Why the same tow wins both times.** At 55% confidence a mobile mechanic carries 45% mismatch risk
— it cannot service the residual chance that this really is a severe overheat — and the ECM prices
that risk above 14 minutes of extra travel. The nearest mechanic sits at 2.3 minutes and still
scores 141.5 against the tow's 130.7. So the code changed the *diagnosis, the job and its cost*,
not the class of provider. If an examiner presses on it, that is the answer: the optimizer is
hedging deliberately, and it would stop hedging as confidence rose.

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

## 8. If something goes sideways

| Symptom | Cause and fix |
| --- | --- |
| Result says Tier-1 on the OBD run | The adapter dropped, so no telemetry reached the payload. Re-pair from the home screen. The app will not silently substitute synthetic data — that is why this shows up honestly. |
| Tier-2, but the diagnosis is still the overheat | The codes did not come back. Almost always the ignition: mode 03 needs the engine running on phone B. |
| Phone shows "Failed to connect to localhost" | A reverse tunnel dropped. Re-run `scripts/demo-phones.sh`. |
| Phone B's simulator has no Fault Memory card | It is running the standalone production APK, not the dev client, so it never loaded today's Metro bundle. Reinstall the dev client build and relaunch through the script. |
| Job vanishes from the provider screen | The 120 s watchdog reclaimed it and offered it elsewhere. Start a fresh incident. |
| "Couldn't reach the diagnosis service" | Dispatch is down or untunnelled. Check `curl http://127.0.0.1:3001/health` — use the literal IP, since `localhost` resolves to IPv6 first on this machine and hangs. |
