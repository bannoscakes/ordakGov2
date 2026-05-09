import { useCallback, useRef, useState } from "react";

export function useDirtyForm<T>(initial: T): {
  values: T;
  setValues: (next: T | ((prev: T) => T)) => void;
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  isDirty: boolean;
  reset: () => void;
  baseline: () => T;
  rebaseline: (next?: T) => void;
} {
  const initialRef = useRef<T>(initial);
  const [values, setValuesState] = useState<T>(initial);

  const setValues = useCallback((next: T | ((prev: T) => T)) => {
    setValuesState((prev) =>
      typeof next === "function" ? (next as (p: T) => T)(prev) : next,
    );
  }, []);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValuesState((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setValuesState(initialRef.current);
  }, []);

  const rebaseline = useCallback((next?: T) => {
    if (next !== undefined) {
      initialRef.current = next;
      setValuesState(next);
    } else {
      initialRef.current = values;
    }
  }, [values]);

  const baseline = useCallback(() => initialRef.current, []);

  return {
    values,
    setValues,
    setField,
    isDirty: !shallowEqual(values, initialRef.current),
    reset,
    baseline,
    rebaseline,
  };
}

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null) return false;
  if (typeof b !== "object" || b === null) return false;

  const aKeys = Object.keys(a as object);
  const bKeys = Object.keys(b as object);
  if (aKeys.length !== bKeys.length) return false;

  for (const k of aKeys) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i++) {
        if (!Object.is(va[i], vb[i])) return false;
      }
      continue;
    }
    if (!Object.is(va, vb)) return false;
  }
  return true;
}
