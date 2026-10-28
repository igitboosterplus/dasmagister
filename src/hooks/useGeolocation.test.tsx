import { renderHook, act, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { useGeolocation } from './useGeolocation';
import { GeolocationTracker } from '@/components/geolocation/GeolocationTracker';

type MockGeolocation = {
  getCurrentPosition: ReturnType<typeof vi.fn>;
  watchPosition: ReturnType<typeof vi.fn>;
  clearWatch: ReturnType<typeof vi.fn>;
};

const buildPosition = (overrides: Partial<GeolocationPosition> = {}): GeolocationPosition => ({
  coords: {
    latitude: 48.8566,
    longitude: 2.3522,
    accuracy: 12,
    altitude: 60,
    altitudeAccuracy: 10,
    heading: null,
    speed: null,
    toJSON: () => ({}),
  },
  timestamp: Date.now(),
  ...overrides,
} as GeolocationPosition);

const mockGeolocation: MockGeolocation = {
  getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(),
};

describe('useGeolocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'geolocation', {
      value: mockGeolocation,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retrieves a single position successfully', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((success) => {
      success(buildPosition());
    });

    const { result } = renderHook(() => useGeolocation());
    const location = await result.current.getCurrentLocation();

    expect(location.latitude).toBe(48.8566);
    expect(result.current.status).toBe('success');
    expect(result.current.location?.latitude).toBe(48.8566);
  });

  it('handles permission denial', async () => {
    mockGeolocation.getCurrentPosition.mockImplementation((_success, error) => {
      error?.({
        code: 1,
        message: 'Permission denied',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    });

    const { result } = renderHook(() => useGeolocation());

    await expect(result.current.getCurrentLocation()).rejects.toMatchObject({
      code: 'permission_denied',
    });
    expect(result.current.error?.code).toBe('permission_denied');
  });

  it('detects unsupported geolocation', () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      value: undefined,
      configurable: true,
    });

    const { result } = renderHook(() => useGeolocation());
    expect(result.current.isSupported).toBe(false);
    expect(result.current.status).toBe('unsupported');
  });

  it('starts and stops tracking with clearWatch', () => {
    mockGeolocation.watchPosition.mockReturnValue(42);

    const { result } = renderHook(() => useGeolocation());

    act(() => {
      result.current.startTracking();
    });

    expect(mockGeolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(result.current.isTracking).toBe(true);

    act(() => {
      result.current.stopTracking();
    });

    expect(mockGeolocation.clearWatch).toHaveBeenCalledWith(42);
    expect(result.current.isTracking).toBe(false);
  });

  it('does not register duplicate watch subscriptions', () => {
    mockGeolocation.watchPosition.mockReturnValue(7);

    const { result } = renderHook(() => useGeolocation());

    act(() => {
      result.current.startTracking();
      result.current.startTracking();
    });

    expect(mockGeolocation.watchPosition).toHaveBeenCalledTimes(1);
  });

  it('ignores GPS updates under the configured distance threshold', () => {
    mockGeolocation.watchPosition.mockImplementation((success) => {
      success(buildPosition({
        coords: { ...buildPosition().coords, latitude: 48.8566001, longitude: 2.3522001, accuracy: 8 },
      }));
      success(buildPosition({
        coords: { ...buildPosition().coords, latitude: 48.8567, longitude: 2.3523, accuracy: 7 },
      }));
    });

    const { result } = renderHook(() => useGeolocation({ distanceFilterMeters: 100 }));

    act(() => {
      result.current.startTracking();
    });

    expect(result.current.location?.latitude).toBeCloseTo(48.8566, 3);
  });

  it('autoStart begins tracking on mount', () => {
    mockGeolocation.watchPosition.mockReturnValue(99);

    const { result } = renderHook(() => useGeolocation({ autoStart: true }));

    expect(mockGeolocation.watchPosition).toHaveBeenCalledTimes(1);
    expect(result.current.isTracking).toBe(true);
  });

  it('calls parent callback when a new location changes', () => {
    const onLocationChange = vi.fn();
    mockGeolocation.watchPosition.mockImplementation((success) => {
      success(buildPosition({ timestamp: Date.now() + 1000 }));
      return 3;
    });

    render(<GeolocationTracker autoStart onLocationChange={onLocationChange} />);

    expect(onLocationChange).toHaveBeenCalledTimes(1);
  });
});
