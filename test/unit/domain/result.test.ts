import { describe, expect, test } from "bun:test";
import {
  type Result,
  err,
  flatMap,
  isErr,
  isOk,
  map,
  ok,
  unwrap,
  unwrapOr,
} from "../../../src/domain/result";

describe("Result", () => {
  describe("ok", () => {
    test("creates success result", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      expect(result.value).toBe(42);
    });
  });

  describe("err", () => {
    test("creates error result", () => {
      const result = err(new Error("failed"));
      expect(result.ok).toBe(false);
      expect(result.error.message).toBe("failed");
    });
  });

  describe("isOk", () => {
    test("returns true for ok result", () => {
      expect(isOk(ok(1))).toBe(true);
    });

    test("returns false for err result", () => {
      expect(isOk(err(new Error("x")))).toBe(false);
    });
  });

  describe("isErr", () => {
    test("returns true for err result", () => {
      expect(isErr(err(new Error("x")))).toBe(true);
    });

    test("returns false for ok result", () => {
      expect(isErr(ok(1))).toBe(false);
    });
  });

  describe("unwrap", () => {
    test("returns value for ok result", () => {
      expect(unwrap(ok(42))).toBe(42);
    });

    test("throws for err result", () => {
      expect(() => unwrap(err(new Error("boom")))).toThrow("boom");
    });
  });

  describe("unwrapOr", () => {
    test("returns value for ok result", () => {
      expect(unwrapOr(ok(42), 0)).toBe(42);
    });

    test("returns default for err result", () => {
      expect(unwrapOr(err(new Error("x")), 0)).toBe(0);
    });
  });

  describe("map", () => {
    test("transforms ok value", () => {
      const result = map(ok(2), (x) => x * 3);
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(6);
      }
    });

    test("passes through err", () => {
      const error = new Error("x");
      const errResult: Result<number, Error> = err(error);
      const result = map(errResult, (x: number) => x * 3);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      }
    });
  });

  describe("flatMap", () => {
    test("chains ok results", () => {
      const result = flatMap(ok(2), (x) => ok(x * 3));
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toBe(6);
      }
    });

    test("short-circuits on err", () => {
      const error = new Error("first");
      const errResult: Result<number, Error> = err(error);
      const result = flatMap(errResult, (x: number) => ok(x * 3));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      }
    });

    test("propagates err from fn", () => {
      const error = new Error("from fn");
      const result = flatMap(ok(2), () => err(error));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error).toBe(error);
      }
    });
  });
});
