---
title: What the OBD readings mean
component: general
topics: [obd, sensors, rpm, coolant, load, fuel trim, voltage]
---

## Engine RPM

Revolutions per minute of the crankshaft. A warm engine at idle usually sits
somewhere around 600 to 900 rpm depending on the vehicle. An idle that is
noticeably high once warm, or that hunts up and down, suggests unmetered air
entering the engine or a throttle body that needs cleaning.

## Vehicle speed

Reported by the vehicle speed sensor. Combined with time, it is what allows
distance to be worked out by integrating speed between readings, which is how a
trip distance can be calculated without GPS.

## Coolant temperature

Most engines settle between roughly 85 and 100 degrees Celsius once warm. A
reading that never climbs into that band suggests a thermostat stuck open,
which wastes fuel and leaves the oil contaminated. A reading that keeps
climbing past the normal band is an overheating engine and is the one reading
that justifies stopping the car.

## Calculated engine load

A percentage describing how much of the engine's available output is being
used at that moment. Low at idle, high under acceleration or when climbing.
Sustained high load correlates with faster wear on the engine and the
transmission, and it is one of the signals that separates gentle driving from
demanding driving.

## Throttle position

How far the accelerator is open, as a percentage. Rapid large changes in
throttle position indicate aggressive acceleration, which is one of the inputs
to a driving behaviour score.

## Long term fuel trim

The persistent correction the engine management applies to its fuel
calculation. Values near zero mean the engine is running as designed. Large
positive values mean fuel is being added to compensate for something, commonly
an air leak or a weak fuel supply. Large negative values mean fuel is being
taken away. It is a direction to investigate, not a diagnosis.

## Battery voltage

Read from the connector pin that stays live with the ignition off. Around 12.4
to 12.7 volts with the engine off indicates a charged battery. Around 13.8 to
14.4 volts indicates the engine is running and the alternator is charging. The
gap between those two bands is what allows engine running state to be detected
from voltage alone, without any other sensor.

## Why more readings make predictions better

A wear prediction improves with the number of trips behind it, because each
trip adds evidence about how this particular car is actually driven rather
than how an average car is assumed to be driven. Early predictions on a
vehicle with few recorded trips are estimates anchored to defaults, which is
why they should be presented as estimates until enough history exists.
