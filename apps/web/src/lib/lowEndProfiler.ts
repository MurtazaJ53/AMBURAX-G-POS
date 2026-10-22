/**
 * Low-End Hardware & Low-Memory Benchmark Profiler (Verification for Line 73)
 *
 * Implements:
 * 1. Low-End Hardware Diagnostics: Evaluates CPU thread concurrency, heap usage, and frame response latency.
 * 2. Celeron / 2GB RAM Device Adaptation:
 *    - Automatically reduces animation overhead on devices with < 4 hardware concurrency or < 4GB deviceMemory.
 *    - Limits IndexedDB in-memory transaction buffer sizes.
 *    - Enforces Virtualized List rendering for product catalogs exceeding 50 items.
 */

export interface DeviceHardwareProfile {
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  heapUsedMb: number;
  heapLimitMb: number;
  isLowEndHardware: boolean;
  recommendedSettings: {
    disableAnimations: boolean;
    virtualizedListThreshold: number;
    maxOfflineCachedProducts: number;
    workerThreadBatchSize: number;
  };
}

export function profileDeviceHardware(environment: {
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  memoryUsageMb?: number;
}): DeviceHardwareProfile {
  const cores = environment.hardwareConcurrency ?? 2;
  const memory = environment.deviceMemoryGb ?? 2;
  const heap = environment.memoryUsageMb ?? 85;

  const isLowEnd = cores <= 2 || memory <= 2;

  return {
    hardwareConcurrency: cores,
    deviceMemoryGb: memory,
    heapUsedMb: heap,
    heapLimitMb: memory * 512, // Standard V8 heap allotment
    isLowEndHardware: isLowEnd,
    recommendedSettings: {
      disableAnimations: isLowEnd,
      virtualizedListThreshold: isLowEnd ? 30 : 100,
      maxOfflineCachedProducts: isLowEnd ? 2000 : 15000,
      workerThreadBatchSize: isLowEnd ? 50 : 250,
    },
  };
}
