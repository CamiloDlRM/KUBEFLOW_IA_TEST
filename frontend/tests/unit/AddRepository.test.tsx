import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import AddRepository from '../../src/pages/AddRepository';

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AddRepository />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AddRepository', () => {
  it('renders form fields correctly', () => {
    renderWithProviders();

    expect(screen.getByLabelText(/GitHub Repository URL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/GitHub Personal Access Token/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Branch/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Notebook Path/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Register Repository/i })).toBeInTheDocument();
  });

  it('validates github url format and shows error for invalid URLs', async () => {
    renderWithProviders();
    const user = userEvent.setup();

    const urlInput = screen.getByLabelText(/GitHub Repository URL/i);
    const tokenInput = screen.getByLabelText(/GitHub Personal Access Token/i);
    const submitBtn = screen.getByRole('button', { name: /Register Repository/i });

    // Use a valid URL format that fails the GitHub-specific regex
    await user.type(urlInput, 'https://gitlab.com/user/repo');
    await user.type(tokenInput, 'ghp_test1234567890');
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/valid GitHub repository URL/i)).toBeInTheDocument();
    });
  });

  it('shows token field as password type by default', () => {
    renderWithProviders();

    const tokenInput = screen.getByLabelText(/GitHub Personal Access Token/i);
    expect(tokenInput).toHaveAttribute('type', 'password');
  });

  it('toggles token visibility on show/hide click', async () => {
    renderWithProviders();
    const user = userEvent.setup();

    const tokenInput = screen.getByLabelText(/GitHub Personal Access Token/i);
    const toggleBtn = screen.getByRole('button', { name: /Show/i });

    expect(tokenInput).toHaveAttribute('type', 'password');

    await user.click(toggleBtn);
    expect(tokenInput).toHaveAttribute('type', 'text');

    // Button text should now say Hide
    expect(screen.getByRole('button', { name: /Hide/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Hide/i }));
    expect(tokenInput).toHaveAttribute('type', 'password');
  });

  it('submits form and shows success with webhook url on success', async () => {
    renderWithProviders();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/GitHub Repository URL/i),
      'https://github.com/testuser/newrepo',
    );
    await user.type(
      screen.getByLabelText(/GitHub Personal Access Token/i),
      'ghp_test1234567890',
    );
    await user.click(screen.getByRole('button', { name: /Register Repository/i }));

    await waitFor(() => {
      expect(screen.getByText(/Repository registered successfully/i)).toBeInTheDocument();
    });

    // Webhook URL should be displayed
    expect(screen.getByText('Webhook URL:')).toBeInTheDocument();
  });

  it('shows error message when API returns error', async () => {
    server.use(
      http.post('http://localhost:8000/repos', () => {
        return HttpResponse.json(
          { detail: 'Failed to create GitHub webhook: rate limit exceeded' },
          { status: 502 },
        );
      }),
    );

    renderWithProviders();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/GitHub Repository URL/i),
      'https://github.com/testuser/errorrepo',
    );
    await user.type(
      screen.getByLabelText(/GitHub Personal Access Token/i),
      'ghp_test1234567890',
    );
    await user.click(screen.getByRole('button', { name: /Register Repository/i }));

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument();
    });
  });

  it('disables submit button during submission', async () => {
    // The response is held open until this test lets it go, rather than for a
    // fixed 200ms. A timed handler leaves the request in flight when the file
    // ends: vitest then deletes jsdom's globals, msw's XHR interceptor reaches
    // for `ProgressEvent` to report the response that finally arrived, and the
    // run fails with an unhandled rejection that names whichever file happened
    // to be running. It only surfaced when the machine was loaded enough for
    // the timer to lose the race, which is the worst way to find out.
    let respond!: () => void;
    const held = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.post('http://localhost:8000/repos', async () => {
        await held;
        return HttpResponse.json(
          { repo_id: 3, webhook_url: 'http://test.com/webhook', status: 'webhook_created' },
          { status: 201 },
        );
      }),
    );

    renderWithProviders();
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText(/GitHub Repository URL/i),
      'https://github.com/testuser/slowrepo',
    );
    await user.type(
      screen.getByLabelText(/GitHub Personal Access Token/i),
      'ghp_test1234567890',
    );

    await user.click(screen.getByRole('button', { name: /Register Repository/i }));

    // Unconditionally: the old version asserted inside `if (pendingBtn)`, so it
    // passed whether or not the button it was looking for ever appeared.
    expect(await screen.findByRole('button', { name: /Registering/i })).toBeDisabled();

    respond();
    await screen.findByText(/Repository registered successfully/i);
  });
});
