import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthDataPanel from '../../src/components/HealthDataPanel';
import type { ProjectPrivacy } from '../../src/types';

const getProjectPrivacy = vi.fn();
const setProjectPrivacy = vi.fn();
const protectProjectData = vi.fn();
const getProjectEncryption = vi.fn();
const encryptProjectData = vi.fn();
const purgeSourceData = vi.fn();

vi.mock('../../src/api/client', () => ({
  getProjectPrivacy: (...a: unknown[]) => getProjectPrivacy(...a),
  setProjectPrivacy: (...a: unknown[]) => setProjectPrivacy(...a),
  protectProjectData: (...a: unknown[]) => protectProjectData(...a),
  getProjectEncryption: (...a: unknown[]) => getProjectEncryption(...a),
  encryptProjectData: (...a: unknown[]) => encryptProjectData(...a),
  purgeSourceData: (...a: unknown[]) => purgeSourceData(...a),
}));

const NO_ENCRYPTION = { enabled: false, buckets: { bronze: 'none' }, objects: 4, encrypted: 0, unknown: 0, job: {} };

const BASES: ProjectPrivacy['legal_bases'] = [
  { kind: 'authorization', title: 'Authorisation of the data subjects', law: 'Ley 1581 de 2012, arts. 6(a) and 9', reference_hint: 'Where the authorisations are kept.' },
  { kind: 'scientific', title: 'Scientific or statistical purpose, with ethics approval', law: 'Ley 1581 de 2012, art. 6(e); Resolución 8430 de 1993', reference_hint: 'Ethics committee approval.' },
  { kind: 'synthetic', title: 'Synthetic data, no real data subjects', law: 'Outside Ley 1581', reference_hint: 'Generator and version.' },
];

function privacy(overrides: Partial<ProjectPrivacy> = {}): ProjectPrivacy {
  return {
    project_id: 4,
    classification: 'general',
    legal_basis: null,
    policy: { pseudonymize: [], suppress: [], keep: [] },
    protection: {},
    unprotected_runs: 0,
    sources: [
      {
        source_id: 1,
        source_name: 'patients',
        active: true,
        landed: true,
        columns: [
          { column: 'ssn', action: 'pseudonymize' },
          { column: 'first_name', action: 'suppress' },
          { column: 'birthdate', action: 'year' },
        ],
      },
    ],
    legal_bases: BASES,
    ...overrides,
  };
}

const HEALTH = privacy({
  classification: 'health',
  legal_basis: {
    kind: 'synthetic',
    purpose: 'Validate the platform',
    reference: 'Synthea sample, seed 20260911',
    responsible: 'Universidad del Norte',
    recorded_by: 'camilo',
    recorded_at: '2026-11-19T10:00:00+00:00',
  },
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HealthDataPanel projectId={4} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getProjectEncryption.mockResolvedValue(NO_ENCRYPTION);
});

describe('HealthDataPanel', () => {
  it('shows what would be protected before the project is marked', async () => {
    getProjectPrivacy.mockResolvedValue(privacy());
    renderPanel();

    expect(await screen.findByText('General data')).toBeInTheDocument();
    expect(screen.getByText('What would be done if marked')).toBeInTheDocument();
    expect(screen.getByText(/→ pseudonymised/)).toBeInTheDocument();
    expect(screen.getByText(/→ removed/)).toBeInTheDocument();
    expect(screen.getByText(/→ year only/)).toBeInTheDocument();
  });

  it('will not mark a project without the full legal basis, then records it', async () => {
    getProjectPrivacy.mockResolvedValue(privacy());
    setProjectPrivacy.mockResolvedValue(HEALTH);
    renderPanel();

    const mark = await screen.findByRole('button', { name: 'Mark as health data' });
    expect(mark).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: /Synthetic data/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /Purpose of the processing/ }), 'Validate the platform');
    await userEvent.type(screen.getByRole('textbox', { name: /^Reference/ }), 'Synthea sample');
    expect(mark).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /Responsible for the processing/ }), 'Uninorte');
    await userEvent.click(mark);

    await waitFor(() =>
      expect(setProjectPrivacy).toHaveBeenCalledWith(4, {
        classification: 'health',
        legal_basis: {
          kind: 'synthetic',
          purpose: 'Validate the platform',
          reference: 'Synthea sample',
          responsible: 'Uninorte',
        },
        policy: { pseudonymize: [], suppress: [], keep: [] },
      }),
    );
    expect(await screen.findByText('Health data · protected')).toBeInTheDocument();
  });

  it('shows the recorded basis of a health project and who recorded it', async () => {
    getProjectPrivacy.mockResolvedValue(HEALTH);
    renderPanel();

    expect(await screen.findByText('Synthea sample, seed 20260911')).toBeInTheDocument();
    expect(screen.getByText(/by camilo/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as health data' })).not.toBeInTheDocument();
  });

  it('offers to protect data stored before the project was marked', async () => {
    getProjectPrivacy.mockResolvedValue(privacy({ ...HEALTH, unprotected_runs: 3 }));
    protectProjectData.mockResolvedValue(privacy({ ...HEALTH, unprotected_runs: 3, protection: { status: 'queued' } }));
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Protect stored data' }));

    expect(protectProjectData).toHaveBeenCalledWith(4);
    expect(await screen.findByRole('status')).toHaveTextContent('Protecting what the project had already stored');
  });

  it('says when protecting failed', async () => {
    getProjectPrivacy.mockResolvedValue(
      privacy({ ...HEALTH, unprotected_runs: 1, protection: { status: 'failed', error: 'bronze unreachable' } }),
    );
    renderPanel();

    expect(await screen.findByText(/Protecting the stored data failed: bronze unreachable/)).toBeInTheDocument();
  });

  it('lists the calls to external AI providers and what was withheld', async () => {
    getProjectPrivacy.mockResolvedValue(
      privacy({
        ...HEALTH,
        egress_total: 1,
        egress: [
          {
            agent: 'advisor.analysis',
            provider: 'anthropic',
            model: 'claude',
            sent_chars: 5120,
            withheld: { cell_outputs: 1, email: 2 },
            ok: true,
            at: '2026-11-19T10:00:00+00:00',
          },
        ],
      }),
    );
    renderPanel();

    const calls = await screen.findByRole('list', { name: 'External AI calls' });
    expect(calls).toHaveTextContent('AI advisor — diagnosis');
    expect(calls).toHaveTextContent('withheld: 1 cell outputs, 2 e-mails');
  });

  it('lists who viewed the data and marks an administrator who is not the owner', async () => {
    getProjectPrivacy.mockResolvedValue(
      privacy({
        ...HEALTH,
        access_total: 2,
        access: [
          { username: 'root', as_admin: true, action: 'layer_preview', resource: 'silver source=1', rows: 50, at: null },
          { username: 'camilo', as_admin: false, action: 'cleaning_steps', resource: 'source=1', rows: 8, at: null },
        ],
      }),
    );
    renderPanel();

    const log = await screen.findByRole('list', { name: 'Data access log' });
    expect(log).toHaveTextContent('rootadmin, not ownerViewed a layer');
    expect(log).toHaveTextContent('camiloViewed the cleaning steps');
    expect(log).toHaveTextContent('50 rows shown');
  });

  it('shows no call log for a general project', async () => {
    getProjectPrivacy.mockResolvedValue(privacy());
    renderPanel();

    await screen.findByText('General data');
    expect(screen.queryByText('Calls to external AI providers')).not.toBeInTheDocument();
  });

  it('says when encryption at rest is not configured', async () => {
    getProjectPrivacy.mockResolvedValue(HEALTH);
    renderPanel();

    expect(await screen.findByText(/Not configured on this deployment/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encrypt stored objects' })).not.toBeInTheDocument();
  });

  it('encrypts what was stored before encryption was on', async () => {
    getProjectPrivacy.mockResolvedValue(HEALTH);
    getProjectEncryption.mockResolvedValue({ ...NO_ENCRYPTION, enabled: true, buckets: { bronze: 'AES256' }, encrypted: 1 });
    encryptProjectData.mockResolvedValue({ ...NO_ENCRYPTION, enabled: true, job: { status: 'queued' } });
    renderPanel();

    expect(await screen.findByText(/1 of 4 stored object\(s\) encrypted by MinIO/)).toBeInTheDocument();
    expect(screen.getByText('bronze: encrypted by default')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Encrypt stored objects' }));
    expect(encryptProjectData).toHaveBeenCalledWith(4);
  });

  it('deletes a source only with a reason and its name typed', async () => {
    getProjectPrivacy.mockResolvedValue(HEALTH);
    purgeSourceData.mockResolvedValue(
      privacy({
        ...HEALTH,
        purges: [
          {
            id: 'p1', source_id: 1, source_name: 'patients', reason: 'Consent withdrawn',
            requested_by: 'camilo', requested_at: '2026-11-19T10:00:00+00:00', status: 'queued',
          },
        ],
      }),
    );
    renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete its data…' }));
    const form = screen.getByRole('form', { name: 'Delete the data of patients' });
    const remove = within(form).getByRole('button', { name: 'Delete permanently' });
    await userEvent.type(within(form).getByRole('textbox', { name: 'Why' }), 'Consent withdrawn');
    await userEvent.type(within(form).getByRole('textbox', { name: /Type patients to confirm/ }), 'patient');
    expect(remove).toBeDisabled();
    await userEvent.type(within(form).getByRole('textbox', { name: /Type patients to confirm/ }), 's');
    await userEvent.click(remove);

    expect(purgeSourceData).toHaveBeenCalledWith(4, 1, { reason: 'Consent withdrawn', confirm: 'patients' });
    const history = await screen.findByRole('list', { name: 'Deleted sources' });
    expect(history).toHaveTextContent('Consent withdrawn');
    expect(history).toHaveTextContent('deleting…');
  });

  it('reports a finished protection', async () => {
    getProjectPrivacy.mockResolvedValue(
      privacy({ ...HEALTH, protection: { status: 'success', runs: 4, purged: 6, gold_version: 9 } }),
    );
    renderPanel();

    expect(await screen.findByText(/4 landed file\(s\) rewritten, 6 object\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/gold rebuilt as v9/)).toBeInTheDocument();
  });
});
