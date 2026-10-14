import {
  DEFAULT_FILTER_AMOUNT,
  getFilterAmount,
  hasFilter,
  IMAGE_FILTER_TYPES,
  setFilterAmount,
  toggleFilter,
} from '@/lib/imageFilters';
import type { ImageFilter } from '@/types/project';

describe('imageFilters — foto szűrő-verem UI-mag', () => {
  it('IMAGE_FILTER_TYPES: az 5 szűrő', () => {
    expect(IMAGE_FILTER_TYPES.map((f) => f.type)).toEqual(['blur', 'sharpen', 'noise', 'grayscale', 'sepia']);
  });

  it('toggleFilter: be/ki, az új a végére kerül', () => {
    let f: ImageFilter[] = [];
    f = toggleFilter(f, 'blur');
    expect(f).toEqual([{ type: 'blur', amount: DEFAULT_FILTER_AMOUNT }]);
    f = toggleFilter(f, 'grayscale', 1);
    expect(f.map((x) => x.type)).toEqual(['blur', 'grayscale']);
    f = toggleFilter(f, 'blur'); // kikapcs
    expect(f.map((x) => x.type)).toEqual(['grayscale']);
  });

  it('hasFilter / getFilterAmount', () => {
    const f: ImageFilter[] = [{ type: 'sharpen', amount: 0.3 }];
    expect(hasFilter(f, 'sharpen')).toBe(true);
    expect(hasFilter(f, 'blur')).toBe(false);
    expect(getFilterAmount(f, 'sharpen')).toBe(0.3);
    expect(getFilterAmount(f, 'blur')).toBe(DEFAULT_FILTER_AMOUNT); // nincs → default
  });

  it('setFilterAmount: állít + 0–1 clamp + no-op ha nincs', () => {
    const f: ImageFilter[] = [{ type: 'blur', amount: 0.5 }];
    expect(setFilterAmount(f, 'blur', 0.9)[0].amount).toBe(0.9);
    expect(setFilterAmount(f, 'blur', 5)[0].amount).toBe(1);
    expect(setFilterAmount(f, 'noise', 0.5)).toEqual(f); // nincs noise → változatlan
  });
});
