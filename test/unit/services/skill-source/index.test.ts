import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearProviders,
  getAllSourceProviders,
  registerDefaultProviders,
} from "../../../../src/services/skill-source";

describe("skill source defaults", () => {
  beforeEach(() => {
    clearProviders();
  });

  afterEach(() => {
    clearProviders();
  });

  test("registers default providers in priority order", () => {
    registerDefaultProviders();

    const providers = getAllSourceProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0]?.name).toBe("github");
    expect(providers[1]?.name).toBe("clawhub");
  });

  test("re-registers defaults after clearProviders", () => {
    registerDefaultProviders();
    clearProviders();

    registerDefaultProviders();
    const providers = getAllSourceProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0]?.name).toBe("github");
    expect(providers[1]?.name).toBe("clawhub");
  });
});
