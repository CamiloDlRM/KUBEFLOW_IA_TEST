import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, REFRESH_EVERY_MS } from '../../src/context/AuthContext';

const refreshToken = vi.fn();

vi.mock('../../src/api/client', () => ({
  TOKEN_KEY: 'mlops_token',
  login: vi.fn(),
  register: vi.fn(),
  getMe: () => Promise.resolve({ username: 'wil@t', role: 'user' }),
  refreshToken: () => refreshToken(),
}));

describe('AuthProvider session renewal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('mlops_token', 'old');
    refreshToken.mockReset().mockResolvedValue({ access_token: 'new' });
  });
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('renews the token while the user is active', async () => {
    render(<AuthProvider><div /></AuthProvider>);

    fireEvent.keyDown(window);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS);
    });

    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('mlops_token')).toBe('new');
  });

  it('lets an idle session run out', async () => {
    render(<AuthProvider><div /></AuthProvider>);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_EVERY_MS * 3);
    });

    expect(refreshToken).not.toHaveBeenCalled();
    expect(localStorage.getItem('mlops_token')).toBe('old');
  });
});
