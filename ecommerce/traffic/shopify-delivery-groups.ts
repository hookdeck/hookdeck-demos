export const SHOPIFY_STORE_DOMAINS = [
  "shop.myshopify.com",
  "acme-store.myshopify.com",
  "northwind-apparel.myshopify.com",
  "peak-performance.myshopify.com",
  "urban-lifestyle.myshopify.com",
  "maple-and-main.myshopify.com",
  "harbor-home.myshopify.com",
  "ember-outdoors.myshopify.com",
  "luna-beauty.myshopify.com",
  "cedar-kitchen.myshopify.com",
  "atlas-fitness.myshopify.com",
  "bluebird-baby.myshopify.com",
  "copper-pet-co.myshopify.com",
  "driftwood-decor.myshopify.com",
  "evergreen-goods.myshopify.com",
  "field-and-forge.myshopify.com",
  "golden-hour.myshopify.com",
  "juniper-market.myshopify.com",
  "kinetic-cycles.myshopify.com",
  "meadow-skincare.myshopify.com",
  "nova-electronics.myshopify.com",
  "oak-and-ivy.myshopify.com",
  "paper-crane.myshopify.com",
  "quartz-watches.myshopify.com",
  "riverbend-books.myshopify.com",
  "summit-supply.myshopify.com",
  "tide-and-thread.myshopify.com",
  "union-coffee.myshopify.com",
  "velvet-vine.myshopify.com",
  "wildflower-studio.myshopify.com",
  "yellow-brick-toys.myshopify.com",
  "zenith-running.myshopify.com",
  "alpine-provisions.myshopify.com",
  "borough-bags.myshopify.com",
  "cloud-nine-sleep.myshopify.com",
  "daybreak-roasters.myshopify.com",
  "eastside-denim.myshopify.com",
  "foxglove-florals.myshopify.com",
  "grain-and-grove.myshopify.com",
  "highline-hardware.myshopify.com",
  "island-pantry.myshopify.com",
  "jigsaw-learning.myshopify.com",
  "kindred-candles.myshopify.com",
  "lantern-lighting.myshopify.com",
  "moonstone-jewelry.myshopify.com",
  "northstar-optics.myshopify.com",
  "orchard-table.myshopify.com",
  "pioneer-tools.myshopify.com",
  "quietude-wellness.myshopify.com",
  "redwood-records.myshopify.com",
] as const;

export type ShopifyStoreDomain = (typeof SHOPIFY_STORE_DOMAINS)[number];
export type ShopifyTrafficPhase = "steady" | "spike" | "recovery";

export interface ShopifyTrafficSample {
  phase: ShopifyTrafficPhase;
  rateMultiplier: number;
  store: ShopifyStoreDomain;
}

export interface ShopifyTrafficState {
  changesAt: number;
  endsAt: number;
  hotStore: ShopifyStoreDomain | null;
  pattern: string;
  phase: ShopifyTrafficPhase;
  rateMultiplier: number;
  weights: Record<ShopifyStoreDomain, number>;
}

interface ShopifyDeliveryGroupTrafficOptions {
  logger?: (message: string) => void;
  now?: () => number;
  random?: () => number;
}

const STEADY_DURATION_MS = [60_000, 360_000] as const;
const STEADY_TOTAL_RATE_PER_MINUTE = [900, 1_800] as const;
const SPIKE_TOTAL_RATE_PER_MINUTE = [1_200, 2_400] as const;
const RECOVERY_TOTAL_RATE_PER_MINUTE = [700, 1_400] as const;
const RECOVERING_STORE_WEIGHT = [0.003, 0.025] as const;
const INITIAL_SPIKE_RATE_PER_MINUTE = [160, 210] as const;
const SPIKE_LULL_RATE_PER_MINUTE = [70, 120] as const;
const SPIKE_LULL_PROBABILITY = 0.18;
const MAX_RECOVERY_STORE_RATE_PER_MINUTE =
  RECOVERY_TOTAL_RATE_PER_MINUTE[1] * RECOVERING_STORE_WEIGHT[1];

const VARIATION_INTERVAL_MS = {
  steady: [45_000, 180_000],
  spike: [30_000, 120_000],
  recovery: [45_000, 180_000],
} as const;

const INITIAL_SPIKE_VARIATION_INTERVAL_MS = [30_000, 75_000] as const;
const RECOVERY_PADDING_MS = [60_000, 180_000] as const;
const MIN_RECOVERY_DURATION_MS = 120_000;

const SPIKE_PATTERNS = [
  {
    name: "flash-sale",
    durationMs: [120_000, 240_000],
    hotRatePerMinute: [150, 205],
  },
  {
    name: "campaign-launch",
    durationMs: [180_000, 360_000],
    hotRatePerMinute: [125, 175],
  },
  {
    name: "bulk-sync",
    durationMs: [90_000, 180_000],
    hotRatePerMinute: [175, 220],
  },
  {
    name: "organic-surge",
    durationMs: [180_000, 360_000],
    hotRatePerMinute: [120, 165],
  },
] as const;

interface TrafficShape {
  rateMultiplier: number;
  weights: Record<ShopifyStoreDomain, number>;
}

interface ShapeTransition {
  endsAt: number;
  from: TrafficShape;
  startsAt: number;
  to: TrafficShape;
}

const randomBetween = (
  [minimum, maximum]: readonly [number, number],
  random: () => number,
) => minimum + random() * (maximum - minimum);

const normalizedWeights = (
  stores: readonly ShopifyStoreDomain[],
  totalWeight: number,
  random: () => number,
): Partial<Record<ShopifyStoreDomain, number>> => {
  const rawWeights = stores.map(() => 0.8 + random() * 0.4);
  const rawTotal = rawWeights.reduce((sum, weight) => sum + weight, 0);

  return stores.reduce<Partial<Record<ShopifyStoreDomain, number>>>(
    (weights, store, index) => {
      weights[store] = (rawWeights[index] / rawTotal) * totalWeight;
      return weights;
    },
    {},
  );
};

const buildWeights = (
  random: () => number,
  weightedStore?: ShopifyStoreDomain,
  weightedStoreWeight?: number,
): Record<ShopifyStoreDomain, number> => {
  if (!weightedStore || weightedStoreWeight === undefined) {
    return normalizedWeights(
      SHOPIFY_STORE_DOMAINS,
      1,
      random,
    ) as Record<ShopifyStoreDomain, number>;
  }

  const otherStores = SHOPIFY_STORE_DOMAINS.filter(
    (store) => store !== weightedStore,
  );

  return {
    ...normalizedWeights(otherStores, 1 - weightedStoreWeight, random),
    [weightedStore]: weightedStoreWeight,
  } as Record<ShopifyStoreDomain, number>;
};

/**
 * Coordinates all Shopify order templates so they share the same traffic phase
 * and store distribution. A spike puts one store's expected rate above 100/minute;
 * recovery lowers every expected rate below that threshold long enough to drain.
 */
export class ShopifyDeliveryGroupTraffic {
  private readonly baseRequestsPerSecond: number;
  private readonly logger: (message: string) => void;
  private readonly now: () => number;
  private readonly random: () => number;
  private estimatedBacklog = 0;
  private lastAccountedAt: number;
  private lastHotStore: ShopifyStoreDomain | null = null;
  private shapeTransition: ShapeTransition | null = null;
  private state: ShopifyTrafficState;

  constructor(
    baseRequestsPerSecond: number,
    options: ShopifyDeliveryGroupTrafficOptions = {},
  ) {
    if (baseRequestsPerSecond <= 0) {
      throw new Error("baseRequestsPerSecond must be greater than zero");
    }

    this.baseRequestsPerSecond = baseRequestsPerSecond;
    this.logger = options.logger ?? console.log;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    const now = this.now();
    this.state = this.createSteadyState(now);
    this.lastAccountedAt = now;
    this.logState("phase");
  }

  next(): ShopifyTrafficSample {
    this.advanceIfNeeded();

    return {
      phase: this.state.phase,
      rateMultiplier: this.state.rateMultiplier,
      store: this.pickStore(this.state.weights),
    };
  }

  getState(): ShopifyTrafficState {
    this.advanceIfNeeded();
    return {
      ...this.state,
      weights: { ...this.state.weights },
    };
  }

  expectedStoreRatesPerMinute(): Record<ShopifyStoreDomain, number> {
    this.advanceIfNeeded();
    return this.ratesForState(this.state);
  }

  private advanceIfNeeded() {
    const now = this.now();
    this.accountForElapsedTime(now);
    this.materializeShape(now);

    if (now >= this.state.endsAt) {
      if (this.state.phase === "steady") {
        this.estimatedBacklog = 0;
        this.enterState(this.createSpikeState(now), now);
      } else if (this.state.phase === "spike") {
        this.enterState(
          this.createRecoveryState(now, this.state.hotStore!),
          now,
        );
      } else if (this.estimatedBacklog > 0.5) {
        this.extendRecovery(now);
      } else {
        this.estimatedBacklog = 0;
        this.enterState(this.createSteadyState(now), now);
      }

      this.lastAccountedAt = now;
      this.logState("phase");
      return;
    }

    if (now >= this.state.changesAt) {
      const changesAt = this.nextChangeAt(
        now,
        this.state.endsAt,
        VARIATION_INTERVAL_MS[this.state.phase],
      );
      this.state = { ...this.state, changesAt };
      this.beginTransition(this.createTargetShape(), now, changesAt);
      this.lastAccountedAt = now;
      this.logState("target");
    }
  }

  private createSteadyState(now: number): ShopifyTrafficState {
    const endsAt =
      now + Math.round(randomBetween(STEADY_DURATION_MS, this.random));

    return this.createState(
      "steady",
      now,
      endsAt,
      null,
      "ambient",
      this.createSteadyShape(),
    );
  }

  private createSpikeState(now: number): ShopifyTrafficState {
    const candidates = SHOPIFY_STORE_DOMAINS.filter(
      (store) => store !== this.lastHotStore,
    );
    const hotStore =
      candidates[Math.floor(this.random() * candidates.length)] ?? candidates[0];
    const pattern =
      SPIKE_PATTERNS[Math.floor(this.random() * SPIKE_PATTERNS.length)] ??
      SPIKE_PATTERNS[0];
    const endsAt =
      now + Math.round(randomBetween(pattern.durationMs, this.random));
    this.lastHotStore = hotStore;

    return this.createState(
      "spike",
      now,
      endsAt,
      hotStore,
      pattern.name,
      this.createSpikeShape(hotStore, INITIAL_SPIKE_RATE_PER_MINUTE),
      INITIAL_SPIKE_VARIATION_INTERVAL_MS,
    );
  }

  private createRecoveryState(
    now: number,
    hotStore: ShopifyStoreDomain,
  ): ShopifyTrafficState {
    const endsAt = now + this.recoveryDurationMs();

    return this.createState(
      "recovery",
      now,
      endsAt,
      hotStore,
      "queue-drain",
      this.createRecoveryShape(hotStore),
    );
  }

  private recoveryDurationMs() {
    const drainRatePerMinute = 100 - MAX_RECOVERY_STORE_RATE_PER_MINUTE;
    const expectedDrainDurationMs =
      (this.estimatedBacklog / drainRatePerMinute) * 60_000 * 1.25;
    return Math.round(
      Math.max(
        MIN_RECOVERY_DURATION_MS,
        expectedDrainDurationMs +
          randomBetween(RECOVERY_PADDING_MS, this.random),
      ),
    );
  }

  private createState(
    phase: ShopifyTrafficPhase,
    now: number,
    endsAt: number,
    hotStore: ShopifyStoreDomain | null,
    pattern: string,
    shape: TrafficShape,
    variationInterval: readonly [number, number] = VARIATION_INTERVAL_MS[phase],
  ): ShopifyTrafficState {
    return {
      changesAt: this.nextChangeAt(now, endsAt, variationInterval),
      endsAt,
      hotStore,
      pattern,
      phase,
      ...shape,
    };
  }

  private createTargetShape(): TrafficShape {
    if (this.state.phase === "steady") {
      return this.createSteadyShape();
    }

    if (this.state.phase === "spike") {
      const pattern =
        SPIKE_PATTERNS.find(({ name }) => name === this.state.pattern) ??
        SPIKE_PATTERNS[0];
      const targetRate =
        this.random() < SPIKE_LULL_PROBABILITY
          ? SPIKE_LULL_RATE_PER_MINUTE
          : pattern.hotRatePerMinute;
      return this.createSpikeShape(this.state.hotStore!, targetRate);
    }

    return this.createRecoveryShape(this.state.hotStore!);
  }

  private enterState(nextState: ShopifyTrafficState, now: number) {
    const currentShape = this.shapeForState(this.state);
    const targetShape = this.shapeForState(nextState);

    this.state = {
      ...nextState,
      ...currentShape,
    };
    this.beginTransition(targetShape, now, nextState.changesAt);
  }

  private extendRecovery(now: number) {
    this.enterState(
      this.createRecoveryState(now, this.state.hotStore!),
      now,
    );
  }

  private beginTransition(
    targetShape: TrafficShape,
    startsAt: number,
    endsAt: number,
  ) {
    if (endsAt <= startsAt) {
      this.state = { ...this.state, ...targetShape };
      this.shapeTransition = null;
      return;
    }

    this.shapeTransition = {
      endsAt,
      from: this.shapeForState(this.state),
      startsAt,
      to: targetShape,
    };
  }

  private materializeShape(at: number) {
    if (!this.shapeTransition) {
      return;
    }

    this.state = { ...this.state, ...this.shapeAt(at) };
    if (at >= this.shapeTransition.endsAt) {
      this.shapeTransition = null;
    }
  }

  private shapeAt(at: number): TrafficShape {
    if (!this.shapeTransition) {
      return this.shapeForState(this.state);
    }

    const { from, to, startsAt, endsAt } = this.shapeTransition;
    const progress = Math.min(
      1,
      Math.max(0, (at - startsAt) / (endsAt - startsAt)),
    );
    const easedProgress = progress * progress * (3 - 2 * progress);

    return {
      rateMultiplier:
        from.rateMultiplier +
        (to.rateMultiplier - from.rateMultiplier) * easedProgress,
      weights: SHOPIFY_STORE_DOMAINS.reduce(
        (weights, store) => {
          weights[store] =
            from.weights[store] +
            (to.weights[store] - from.weights[store]) * easedProgress;
          return weights;
        },
        {} as Record<ShopifyStoreDomain, number>,
      ),
    };
  }

  private shapeForState(state: ShopifyTrafficState): TrafficShape {
    return {
      rateMultiplier: state.rateMultiplier,
      weights: { ...state.weights },
    };
  }

  private createSteadyShape(): TrafficShape {
    const totalRatePerMinute = randomBetween(
      STEADY_TOTAL_RATE_PER_MINUTE,
      this.random,
    );

    return {
      rateMultiplier: totalRatePerMinute / (this.baseRequestsPerSecond * 60),
      weights: buildWeights(this.random),
    };
  }

  private createSpikeShape(
    hotStore: ShopifyStoreDomain,
    hotRateRange: readonly [number, number],
  ): TrafficShape {
    const hotStoreRatePerMinute = randomBetween(hotRateRange, this.random);
    const totalRatePerMinute = randomBetween(
      SPIKE_TOTAL_RATE_PER_MINUTE,
      this.random,
    );
    const hotStoreWeight = hotStoreRatePerMinute / totalRatePerMinute;

    return {
      rateMultiplier: totalRatePerMinute / (this.baseRequestsPerSecond * 60),
      weights: buildWeights(this.random, hotStore, hotStoreWeight),
    };
  }

  private createRecoveryShape(hotStore: ShopifyStoreDomain): TrafficShape {
    const totalRatePerMinute = randomBetween(
      RECOVERY_TOTAL_RATE_PER_MINUTE,
      this.random,
    );
    const hotStoreWeight = randomBetween(RECOVERING_STORE_WEIGHT, this.random);

    return {
      rateMultiplier: totalRatePerMinute / (this.baseRequestsPerSecond * 60),
      weights: buildWeights(this.random, hotStore, hotStoreWeight),
    };
  }

  private nextChangeAt(
    now: number,
    endsAt: number,
    interval: readonly [number, number],
  ) {
    return Math.min(
      endsAt,
      now + Math.round(randomBetween(interval, this.random)),
    );
  }

  private accountForElapsedTime(now: number) {
    const accountedUntil = Math.min(now, this.state.endsAt);
    if (accountedUntil <= this.lastAccountedAt) {
      return;
    }

    if (this.state.hotStore && this.state.phase !== "steady") {
      const midpoint = (this.lastAccountedAt + accountedUntil) / 2;
      const startRate =
        this.ratesForShape(this.shapeAt(this.lastAccountedAt))[
          this.state.hotStore
        ];
      const midpointRate =
        this.ratesForShape(this.shapeAt(midpoint))[this.state.hotStore];
      const endRate =
        this.ratesForShape(this.shapeAt(accountedUntil))[this.state.hotStore];
      const averageHotStoreRate =
        (startRate + 4 * midpointRate + endRate) / 6;
      const elapsedMinutes =
        (accountedUntil - this.lastAccountedAt) / 60_000;
      this.estimatedBacklog = Math.max(
        0,
        this.estimatedBacklog +
          (averageHotStoreRate - 100) * elapsedMinutes,
      );
    }

    this.lastAccountedAt = accountedUntil;
  }

  private pickStore(
    weights: Record<ShopifyStoreDomain, number>,
  ): ShopifyStoreDomain {
    const target = this.random();
    let cumulativeWeight = 0;

    for (const store of SHOPIFY_STORE_DOMAINS) {
      cumulativeWeight += weights[store];
      if (target < cumulativeWeight) {
        return store;
      }
    }

    return SHOPIFY_STORE_DOMAINS[SHOPIFY_STORE_DOMAINS.length - 1];
  }

  private ratesForState(
    state: ShopifyTrafficState,
  ): Record<ShopifyStoreDomain, number> {
    return this.ratesForShape(this.shapeForState(state));
  }

  private ratesForShape(
    shape: TrafficShape,
  ): Record<ShopifyStoreDomain, number> {
    const totalRatePerMinute =
      this.baseRequestsPerSecond * shape.rateMultiplier * 60;

    return SHOPIFY_STORE_DOMAINS.reduce(
      (rates, store) => {
        rates[store] = totalRatePerMinute * shape.weights[store];
        return rates;
      },
      {} as Record<ShopifyStoreDomain, number>,
    );
  }

  private logState(change: "phase" | "target") {
    const durationSeconds = Math.round((this.state.endsAt - this.now()) / 1000);
    const rates = this.ratesForState(this.state);
    const rateSummary = Object.entries(rates)
      .sort(([, leftRate], [, rightRate]) => rightRate - leftRate)
      .slice(0, 6)
      .map(([store, rate]) => `${store}=${Math.round(rate)}/min`)
      .join(", ");

    this.logger(
      `[shopify delivery groups] change=${change} phase=${this.state.phase} pattern=${this.state.pattern} remaining=${durationSeconds}s top_rates=${rateSummary}`,
    );
  }
}

/** Add natural request-to-request jitter while preserving the phase's mean rate. */
export const poissonDelaySeconds = (
  requestsPerSecond: number,
  random: () => number = Math.random,
) => {
  const sample = Math.min(Math.max(random(), Number.EPSILON), 1 - Number.EPSILON);
  return Math.max(0.005, -Math.log(1 - sample) / requestsPerSecond);
};
