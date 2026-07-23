import { describe, expect, test } from "bun:test";

import {
  SHOPIFY_STORE_DOMAINS,
  ShopifyDeliveryGroupTraffic,
} from "./shopify-delivery-groups";

describe("ShopifyDeliveryGroupTraffic", () => {
  test("uses 50 unique Shopify stores", () => {
    expect(SHOPIFY_STORE_DOMAINS).toHaveLength(50);
    expect(new Set(SHOPIFY_STORE_DOMAINS).size).toBe(50);
  });

  test("keeps aggregate Shopify order traffic at high volume", () => {
    let now = 0;
    const traffic = new ShopifyDeliveryGroupTraffic(6, {
      logger: () => {},
      now: () => now,
      random: () => 0.5,
    });
    const totalRate = () =>
      Object.values(traffic.expectedStoreRatesPerMinute()).reduce(
        (total, rate) => total + rate,
        0,
      );

    let state = traffic.getState();
    expect(totalRate()).toBeCloseTo(1_350, 6);

    now = state.endsAt;
    state = traffic.getState();
    now = state.changesAt;
    state = traffic.getState();
    expect(totalRate()).toBeCloseTo(1_800, 6);

    now = state.endsAt;
    state = traffic.getState();
    now = state.changesAt;
    traffic.getState();
    expect(totalRate()).toBeCloseTo(1_050, 6);
  });

  test("creates a rotating backlog and recovery cycle at 100 deliveries/minute", () => {
    let now = 0;
    const traffic = new ShopifyDeliveryGroupTraffic(6, {
      logger: () => {},
      now: () => now,
      random: () => 0.5,
    });

    let state = traffic.getState();
    expect(state.phase).toBe("steady");
    expect(Object.values(traffic.expectedStoreRatesPerMinute()).every(
      (rate) => rate < 100,
    )).toBe(true);

    now = state.endsAt;
    state = traffic.getState();
    expect(state.phase).toBe("spike");
    const firstHotStore = state.hotStore!;
    const firstSpikeEndsAt = state.endsAt;

    // The hot store ramps into the surge instead of jumping at the phase edge.
    now = state.changesAt;
    state = traffic.getState();
    const spikeRates = traffic.expectedStoreRatesPerMinute();
    expect(spikeRates[firstHotStore]).toBeGreaterThan(100);
    expect(SHOPIFY_STORE_DOMAINS.filter((store) => store !== firstHotStore).every(
      (store) => spikeRates[store] < 100,
    )).toBe(true);

    now = firstSpikeEndsAt;
    state = traffic.getState();
    expect(state.phase).toBe("recovery");
    expect(state.hotStore).toBe(firstHotStore);

    // Recovery also ramps down, preserving continuity at the phase boundary.
    now = state.changesAt;
    state = traffic.getState();
    expect(Object.values(traffic.expectedStoreRatesPerMinute()).every(
      (rate) => rate < 100,
    )).toBe(true);

    while (state.phase === "recovery") {
      now = state.endsAt;
      state = traffic.getState();
    }
    expect(state.phase).toBe("steady");

    now = state.endsAt;
    state = traffic.getState();
    expect(state.phase).toBe("spike");
    expect(state.hotStore).not.toBe(firstHotStore);
  });

  test("always produces normalized store weights", () => {
    let now = 0;
    const traffic = new ShopifyDeliveryGroupTraffic(6, {
      logger: () => {},
      now: () => now,
      random: () => 0.25,
    });

    for (let phase = 0; phase < 4; phase++) {
      const state = traffic.getState();
      const totalWeight = Object.values(state.weights).reduce(
        (total, weight) => total + weight,
        0,
      );
      expect(totalWeight).toBeCloseTo(1, 10);
      now = state.endsAt;
    }
  });

  test("eases rates and store weights between irregular targets", () => {
    let now = 0;
    let randomState = 42;
    const logs: string[] = [];
    const traffic = new ShopifyDeliveryGroupTraffic(6, {
      logger: (message) => logs.push(message),
      now: () => now,
      random: () => {
        randomState = (randomState * 16_807) % 2_147_483_647;
        return (randomState - 1) / 2_147_483_646;
      },
    });

    let state = traffic.getState();
    now = state.endsAt;
    state = traffic.getState();

    const hotStore = state.hotStore!;
    const transitionStartsAt = now;
    const transitionEndsAt = state.changesAt;
    const transitionDuration = transitionEndsAt - transitionStartsAt;
    const startState = state;
    const startRate = traffic.expectedStoreRatesPerMinute()[hotStore];

    now = transitionStartsAt + transitionDuration * 0.25;
    const quarterState = traffic.getState();
    const quarterRate = traffic.expectedStoreRatesPerMinute()[hotStore];

    now = transitionStartsAt + transitionDuration * 0.5;
    const midpointState = traffic.getState();
    const midpointRate = traffic.expectedStoreRatesPerMinute()[hotStore];

    now = transitionEndsAt;
    const endState = traffic.getState();
    const endRate = traffic.expectedStoreRatesPerMinute()[hotStore];

    expect(startRate).toBeLessThan(quarterRate);
    expect(quarterRate).toBeLessThan(midpointRate);
    expect(midpointRate).toBeLessThan(endRate);
    expect(quarterState.rateMultiplier).not.toBe(startState.rateMultiplier);
    expect(midpointState.weights).not.toEqual(startState.weights);
    expect(endState.phase).toBe("spike");
    expect(logs.some((message) => message.includes("change=target"))).toBe(true);
  });

  test("varies spike pattern, height, and duration between episodes", () => {
    const patterns = new Set<string>();
    const durations = new Set<number>();
    const hotStoreRates = new Set<number>();

    for (let seed = 1; seed <= 200; seed++) {
      let randomState = seed;
      const random = () => {
        randomState = (randomState * 16_807) % 2_147_483_647;
        return (randomState - 1) / 2_147_483_646;
      };
      let now = 0;
      const traffic = new ShopifyDeliveryGroupTraffic(6, {
        logger: () => {},
        now: () => now,
        random,
      });

      let state = traffic.getState();
      now = state.endsAt;
      state = traffic.getState();

      patterns.add(state.pattern);
      durations.add(Math.round((state.endsAt - now) / 1000));
      now = state.changesAt;
      state = traffic.getState();
      hotStoreRates.add(
        Math.round(
          traffic.expectedStoreRatesPerMinute()[state.hotStore!],
        ),
      );
    }

    expect(patterns.size).toBe(4);
    expect(durations.size).toBeGreaterThan(20);
    expect(hotStoreRates.size).toBeGreaterThan(20);
  });

  test("adaptive recovery drains randomized, multi-pulse spikes", () => {
    for (let seed = 1; seed <= 200; seed++) {
      let randomState = seed;
      const random = () => {
        randomState = (randomState * 16_807) % 2_147_483_647;
        return (randomState - 1) / 2_147_483_646;
      };
      let now = 0;
      const traffic = new ShopifyDeliveryGroupTraffic(6, {
        logger: () => {},
        now: () => now,
        random,
      });

      let state = traffic.getState();
      now = state.endsAt;
      state = traffic.getState();

      const hotStore = state.hotStore!;
      let expectedBacklog = 0;
      let maximumBacklog = 0;
      let iterations = 0;
      let previousHotStoreRate =
        traffic.expectedStoreRatesPerMinute()[hotStore];

      while (state.phase === "spike") {
        const intervalMs = Math.min(5_000, state.endsAt - now);
        now += intervalMs;
        state = traffic.getState();
        const hotStoreRate = traffic.expectedStoreRatesPerMinute()[hotStore];
        expectedBacklog = Math.max(
          0,
          expectedBacklog +
            ((previousHotStoreRate + hotStoreRate) / 2 - 100) *
              (intervalMs / 60_000),
        );
        maximumBacklog = Math.max(maximumBacklog, expectedBacklog);
        previousHotStoreRate = hotStoreRate;
        expect(iterations++).toBeLessThan(2_000);
      }

      expect(state.phase).toBe("recovery");

      while (state.phase === "recovery") {
        const intervalMs = Math.min(5_000, state.endsAt - now);
        now += intervalMs;
        state = traffic.getState();
        const hotStoreRate = traffic.expectedStoreRatesPerMinute()[hotStore];
        expectedBacklog = Math.max(
          0,
          expectedBacklog +
            ((previousHotStoreRate + hotStoreRate) / 2 - 100) *
              (intervalMs / 60_000),
        );
        previousHotStoreRate = hotStoreRate;
        expect(iterations++).toBeLessThan(2_000);
      }

      expect(maximumBacklog).toBeGreaterThan(0);
      expect(maximumBacklog).toBeLessThan(500);
      expect(expectedBacklog).toBeLessThan(2);
    }
  });
});
