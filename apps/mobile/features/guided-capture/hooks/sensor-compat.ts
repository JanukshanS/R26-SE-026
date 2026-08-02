/**
 * expo-sensors@15.x DeviceSensor.addListener calls nativeModule.addListener(eventName, handler)
 * which is the old React Native bridge pattern. In expo-modules-core 3.x (SDK 54) the native
 * module object doesn't expose addListener directly — you must go through EventEmitter.
 * These wrappers try the expo-sensors public API first and fall back to EventEmitter when it throws.
 */
import { EventEmitter, requireOptionalNativeModule } from 'expo-modules-core';
import { Accelerometer, Gyroscope, Magnetometer } from 'expo-sensors';
import type {
  AccelerometerMeasurement,
  GyroscopeMeasurement,
  MagnetometerMeasurement,
} from 'expo-sensors';

type Subscription = { remove: () => void };

const NOOP_SUB: Subscription = { remove: () => {} };

function subscribeViaEventEmitter<T>(
  moduleName: string,
  eventName: string,
  listener: (data: T) => void
): Subscription {
  try {
    const mod = requireOptionalNativeModule(moduleName);
    if (!mod) return NOOP_SUB;
    const emitter = new EventEmitter(mod as ConstructorParameters<typeof EventEmitter>[0]);
    return (emitter as unknown as { addListener: (name: string, cb: (d: T) => void) => Subscription })
      .addListener(eventName, listener);
  } catch {
    return NOOP_SUB;
  }
}

export function addAccelerometerListener(
  listener: (data: AccelerometerMeasurement) => void
): Subscription {
  try {
    return Accelerometer.addListener(listener);
  } catch {
    return subscribeViaEventEmitter('ExponentAccelerometer', 'accelerometerDidUpdate', listener);
  }
}

export function addGyroscopeListener(
  listener: (data: GyroscopeMeasurement) => void
): Subscription {
  try {
    return Gyroscope.addListener(listener);
  } catch {
    return subscribeViaEventEmitter('ExponentGyroscope', 'gyroscopeDidUpdate', listener);
  }
}

export function addMagnetometerListener(
  listener: (data: MagnetometerMeasurement) => void
): Subscription {
  try {
    return Magnetometer.addListener(listener);
  } catch {
    return subscribeViaEventEmitter('ExponentMagnetometer', 'magnetometerDidUpdate', listener);
  }
}
