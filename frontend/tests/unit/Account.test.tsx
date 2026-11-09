import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import Account from '../../src/pages/Account';
import type { UserResponse } from '../../src/types';

const getGithubTokenStatus = vi.fn();
vi.mock('../../src/api/client', () => ({
  getGithubTokenStatus: () => getGithubTokenStatus(),
  requestChangePassword: vi.fn(),
  updateEmail: vi.fn(),
  updateGithubToken: vi.fn(),
}));

const useAuth = vi.fn();
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => useAuth() }));

function user(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: 1,
    username: 'wil@t',
    role: 'member',
    email: 'wil@example.com',
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    needs_password: false,
    auth_provider: 'token',
    has_github_token: true,
    github_token_masked: '****9999',
    ...overrides,
  };
}

function renderPage(currentUser: UserResponse) {
  useAuth.mockReturnValue({ currentUser, refreshUser: vi.fn() });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Account />
    </QueryClientProvider>,
  );
}

describe('Account', () => {
  it('shows who is signed in and whether their GitHub token still works', async () => {
    getGithubTokenStatus.mockResolvedValue('expiring');
    renderPage(user());

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('wil@t')).toBeInTheDocument();
    expect(screen.getByText('Username and password')).toBeInTheDocument();
    expect(screen.getByText('****9999')).toBeInTheDocument();
    expect(await screen.findByText('Expires in under 7 days')).toBeInTheDocument();
  });

  it('lets the password and token change, but not the username or the email', () => {
    getGithubTokenStatus.mockResolvedValue('ok');
    renderPage(user());

    expect(screen.getByRole('button', { name: 'Password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'GitHub token' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Username' })).not.toBeInTheDocument();
  });

  it('asks for an email only while the account has none, and opens there', () => {
    getGithubTokenStatus.mockResolvedValue('ok');
    renderPage(user({ email: null }));

    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save email' })).toBeInTheDocument();
    expect(screen.getByText(/cannot be changed afterwards/)).toBeInTheDocument();
  });

  it('has no token form for GitHub accounts, who renew it by signing in again', async () => {
    getGithubTokenStatus.mockResolvedValue('invalid');
    renderPage(user({ auth_provider: 'github', username: 'wil@g' }));

    expect(screen.queryByRole('button', { name: 'GitHub token' })).not.toBeInTheDocument();
    expect(await screen.findByText('Sign in again with GitHub to renew it.')).toBeInTheDocument();
  });
});
