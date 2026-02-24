import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createRepo } from '../api/client';
import Spinner from '../components/Spinner';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+\/?$/;

export default function AddRepository() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [branch, setBranch] = useState('main');
  const [notebookPath, setNotebookPath] = useState('/');
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: createRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    if (!GITHUB_URL_REGEX.test(url.trim())) {
      setValidationError('Please enter a valid GitHub repository URL (e.g. https://github.com/user/repo)');
      return;
    }

    if (!token.trim()) {
      setValidationError('A GitHub Personal Access Token is required.');
      return;
    }

    mutation.mutate({
      github_url: url.trim(),
      github_token: token.trim(),
      branch: branch.trim() || 'main',
      notebook_path: notebookPath.trim() || '/',
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Add Repository</h2>
        <p className="mt-1 text-sm text-slate-400">
          Register a GitHub repository to monitor for notebook changes. A webhook will be
          created to trigger pipelines on push events.
        </p>
      </div>

      {/* Success state */}
      {mutation.isSuccess && mutation.data && (
        <div className="rounded-lg border border-emerald-700 bg-emerald-900/20 p-4">
          <p className="text-sm font-medium text-emerald-300">
            Repository registered successfully.
          </p>
          {mutation.data.webhook_url && (
            <div className="mt-2">
              <p className="text-xs text-slate-400">Webhook URL:</p>
              <code className="mt-1 block break-all rounded bg-slate-800 px-3 py-2 text-xs text-slate-200">
                {mutation.data.webhook_url}
              </code>
            </div>
          )}
          <button
            onClick={() => navigate('/')}
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
          >
            Go to Dashboard
          </button>
        </div>
      )}

      {/* Form */}
      {!mutation.isSuccess && (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Validation / mutation errors */}
          {(validationError || mutation.isError) && (
            <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">
              {validationError ?? (mutation.error as Error).message}
            </div>
          )}

          {/* GitHub URL */}
          <div>
            <label htmlFor="repo-url" className="mb-1 block text-sm font-medium text-slate-300">
              GitHub Repository URL
            </label>
            <input
              id="repo-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Token */}
          <div>
            <label htmlFor="token" className="mb-1 block text-sm font-medium text-slate-300">
              GitHub Personal Access Token
            </label>
            <div className="relative">
              <input
                id="token"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_..."
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 pr-16 text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={() => setShowToken((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
              >
                {showToken ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Branch */}
          <div>
            <label htmlFor="branch" className="mb-1 block text-sm font-medium text-slate-300">
              Branch
            </label>
            <input
              id="branch"
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Notebook path */}
          <div>
            <label htmlFor="notebook" className="mb-1 block text-sm font-medium text-slate-300">
              Notebook Path
            </label>
            <input
              id="notebook"
              type="text"
              value={notebookPath}
              onChange={(e) => setNotebookPath(e.target.value)}
              placeholder="notebooks/train.ipynb"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {mutation.isPending && <Spinner size="sm" />}
              {mutation.isPending ? 'Registering...' : 'Register Repository'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-lg border border-slate-700 px-5 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
