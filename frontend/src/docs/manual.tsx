import type { ReactNode } from 'react';
import {
  AdvisorScreen,
  CanvasScreen,
  ConnectScreen,
  DashboardScreen,
  KpiScreen,
  LinkRepoScreen,
  LoginScreen,
  MetricsScreen,
  ModelsScreen,
  ProjectScreen,
  ProjectsScreen,
  RecentRunsScreen,
  RunScreen,
  SettingsScreen,
  ShellScreen,
  StagesScreen,
} from '../components/docs/Wireframes';
import {
  IssuesTable,
  LayersBlock,
  NotebookBlock,
} from '../components/docs/ManualBlocks';

/**
 * The manual, as data.
 *
 * Chapters are numbered because they are read in order the first time. The
 * sections inside them are not, because nobody works through Maia in a line:
 * a reader arrives looking for one screen and should be able to jump straight
 * to it from the contents or the search box.
 */

export type ManualChapter = {
  id: string;
  number: string;
  title: string;
  blurb: string;
};

export type ManualSection = {
  id: string;
  chapter: string;
  /** Short label in the contents. */
  nav: string;
  title: string;
  keywords: string[];
  lede: string;
  wireframe?: ReactNode;
  anatomy?: { n: number; label: string; text: ReactNode }[];
  steps?: { title: string; body: ReactNode }[];
  fields?: { term: string; text: ReactNode }[];
  notes?: { tone?: 'tip' | 'watch'; title?: string; body: ReactNode }[];
  qa?: { q: string; a: ReactNode }[];
  /** A section-shaped block that does not fit the other slots. */
  extra?: ReactNode;
};

/** A label that exists verbatim in the interface. */
function Ui({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-[var(--rule)] bg-[var(--paper-soft)] px-1 py-px font-display text-[0.86em] text-[var(--ink)]">
      {children}
    </code>
  );
}

export const CHAPTERS: ManualChapter[] = [
  {
    id: 'start',
    number: '01',
    title: 'Start here',
    blurb: 'What Maia does, how to get in, and what the six items on the left are for.',
  },
  {
    id: 'home',
    number: '02',
    title: 'Your home screen',
    blurb: 'The Dashboard: whether the platform is up, what has run, and how the models are doing.',
  },
  {
    id: 'data',
    number: '03',
    title: 'Projects and data',
    blurb: 'From an empty project to a gold table — including the part a data team can own without writing code.',
  },
  {
    id: 'pipelines',
    number: '04',
    title: 'Pipelines',
    blurb: 'The notebook path: the canvas, a run, the record it leaves, and the advisor that reads it.',
  },
  {
    id: 'account',
    number: '05',
    title: 'Models and account',
    blurb: 'What is being served, how to test it, and how to change your own credentials.',
  },
  {
    id: 'help',
    number: '06',
    title: 'Help',
    blurb: 'Short answers, and what to do when a screen disagrees with this manual.',
  },
];

export const SECTIONS: ManualSection[] = [
  /* ---------------------------------------------------------------- */
  /*  01 — Start here                                                  */
  /* ---------------------------------------------------------------- */
  {
    id: 'welcome',
    chapter: 'start',
    nav: 'What Maia is',
    title: 'A notebook, turned into a service',
    keywords: ['overview', 'introduction', 'maia', 'workflow', 'what is this', 'start'],
    lede: 'Maia is where a notebook stops being a file and starts answering requests. You bring the data and the code; Maia runs the notebook, records what happened, and serves the model it produced.',
    steps: [
      {
        title: 'Name a project',
        body: (
          <>
            A project is the container: its data, its notebook, its runs, its models. It
            asks for one field — a name — and nothing else.
          </>
        ),
      },
      {
        title: 'Bring data in',
        body: (
          <>
            Connect a database or upload a file. Each extraction lands in bronze, is cleaned
            into silver, and becomes gold — the table training reads.
          </>
        ),
      },
      {
        title: 'Link a notebook',
        body: (
          <>
            Point the project at a GitHub repository, a branch, and one <code>.ipynb</code>.
            That notebook is the training job.
          </>
        ),
      },
      {
        title: 'Run it',
        body: (
          <>
            <Ui>Run pipeline</Ui> executes the tagged cells on the input you choose. You
            watch phases and logs. A model comes out only if the run succeeds and clears the
            accuracy gate.
          </>
        ),
      },
      {
        title: 'Use the model',
        body: (
          <>
            <Ui>Models</Ui> holds the endpoint, a test payload, rollback, and delete. The
            loop from there is another run, not another tool.
          </>
        ),
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Data first is a supported order',
        body: (
          <>
            A project can collect and clean data for weeks before a repository exists. The
            Data Factory never asks for code.
          </>
        ),
      },
      {
        tone: 'watch',
        title: 'What runs is what is on the branch',
        body: (
          <>
            Maia executes the notebook as it exists in GitHub on the linked branch. A change
            you have saved locally but not pushed is not part of the run.
          </>
        ),
      },
    ],
  },

  {
    id: 'sign-in',
    chapter: 'start',
    nav: 'Signing in',
    title: 'Signing in, and getting an account',
    keywords: ['login', 'log in', 'password', 'invite', 'register', 'account', 'access', 'sign out'],
    lede: 'Sign in with the username and password you were given. Maia has no public sign-up: every account begins with an invitation from an administrator.',
    wireframe: <LoginScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Username',
        text: 'The one your administrator set up. It is not necessarily your email address.',
      },
      {
        n: 2,
        label: 'Password',
        text: 'Between 8 and 72 characters. Both fields are case-sensitive.',
      },
      {
        n: 3,
        label: 'Sign in',
        text: 'Opens the Dashboard. A wrong password says so without saying which field was wrong.',
      },
      {
        n: 4,
        label: 'Registration',
        text: (
          <>
            If you have an invite link, it opens the register page with a token already in
            the address. Without the token, registration refuses to start.
          </>
        ),
      },
    ],
    steps: [
      {
        title: 'Open Maia and choose Sign in',
        body: 'The landing page links to the form. Your session stays open until you sign out.',
      },
      {
        title: 'Accept your invitation, if this is the first time',
        body: (
          <>
            The email from your administrator contains a link to the register page. Choose a
            username and a password there. The link works once.
          </>
        ),
      },
      {
        title: 'If the link has expired',
        body: 'The page will say the token is invalid, used, or expired. Ask for a fresh invitation; there is no self-service reset.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'Invitations expire',
        body: 'An administrator chooses 24 hours to 7 days when sending one. A link that sat in an inbox over a weekend may already be dead.',
      },
      {
        tone: 'tip',
        title: 'Signing out',
        body: (
          <>
            <Ui>Sign out</Ui> sits at the bottom of the sidebar on desktop, and as an icon in
            the top bar on a phone.
          </>
        ),
      },
    ],
  },

  {
    id: 'navigation',
    chapter: 'start',
    nav: 'Finding your way',
    title: 'Six places, one sidebar',
    keywords: ['navigation', 'sidebar', 'menu', 'dashboard', 'projects', 'models', 'repos', 'settings', 'admin', 'mobile'],
    lede: 'The sidebar is the map of the product. It never changes while you work, so a control you learned once stays where you learned it.',
    wireframe: <ShellScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Dashboard',
        text: 'Platform health, the latest runs, and model metrics. The screen you land on after signing in.',
      },
      {
        n: 2,
        label: 'Projects',
        text: 'The work itself. Most days start here, because runs are started from a project.',
      },
      {
        n: 3,
        label: 'Models',
        text: 'What is currently deployed and how to call it. Refreshes itself every 15 seconds.',
      },
      {
        n: 4,
        label: 'My Repos',
        text: 'GitHub repositories registered with Maia. A repository is linked to a project later; this page only holds the connection.',
      },
      {
        n: 5,
        label: 'Settings',
        text: 'Your email, password, and username. Every change needs an email confirmation.',
      },
      {
        n: 6,
        label: 'Admin',
        text: 'Invitations. Only visible if your account is an administrator.',
      },
      {
        n: 7,
        label: 'Sign out',
        text: 'Ends the session and returns to the landing page.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'On a phone',
        body: 'The sidebar becomes a top bar of icons. They lead to the same places; touch targets are deliberately larger than they look.',
      },
      {
        tone: 'watch',
        title: 'This manual is not in the sidebar',
        body: (
          <>
            It lives at <code>/docs</code>, linked from the landing page, so it is not in the
            way while you work. Keep it in a second tab.
          </>
        ),
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  02 — Your home screen                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'dashboard',
    chapter: 'home',
    nav: 'The Dashboard',
    title: 'What the Dashboard is for',
    keywords: ['dashboard', 'home', 'overview', 'recent runs', 'health', 'metrics', 'first screen'],
    lede: 'The Dashboard answers two questions before you click anything: what has run, and is the platform healthy. It is a reading screen — no run is started here.',
    wireframe: <DashboardScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Service health',
        text: 'Four dots: Backend, Redis, MLflow, Model Server. Green means reachable at page load.',
      },
      {
        n: 2,
        label: 'Projects',
        text: 'The only action in the header. Takes you to the list where new work begins.',
      },
      {
        n: 3,
        label: 'Recent pipelines',
        text: 'The five newest runs across every project. The short id opens the run.',
      },
      {
        n: 4,
        label: 'Model metrics',
        text: 'Embedded Grafana panels, below the fold. Training and traffic rather than individual runs.',
      },
    ],
    steps: [
      {
        title: 'Glance at the health dots',
        body: 'If Backend is red, stop: nothing else on the page is reliable until it recovers.',
      },
      {
        title: 'Scan the latest runs',
        body: 'A red row is yesterday’s work, not a notification — open it and read the failing phase.',
      },
      {
        title: 'Drop into metrics only when the question is a trend',
        body: '“Is accuracy drifting?” belongs here. “What did run 4f2a do?” belongs on the run page.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Runs start in Projects',
        body: (
          <>
            Open a project, then its pipeline, then <Ui>Run pipeline</Ui>. The Dashboard is
            deliberately read-only so a stray click cannot start compute.
          </>
        ),
      },
      {
        tone: 'watch',
        title: '“Recent” means five',
        body: 'Older runs are not hidden, just elsewhere: the pipeline canvas lists the last fifteen for its repository.',
      },
    ],
  },

  {
    id: 'health',
    chapter: 'home',
    nav: 'Service health',
    title: 'Reading the four dots',
    keywords: ['health', 'status', 'backend', 'redis', 'mlflow', 'model server', 'down', 'red', 'outage'],
    lede: 'Almost every support conversation starts here. The dots are checked when the page loads; nothing polls them in the background.',
    fields: [
      {
        term: 'Backend',
        text: 'The API and the data behind every screen. Red means the page itself cannot load, and the other three readings are not trustworthy.',
      },
      {
        term: 'Redis',
        text: 'The queue between the app and its workers. Red means a run can be accepted but will not start.',
      },
      {
        term: 'MLflow',
        text: 'Where runs and models are recorded. Red means a finished run cannot register a model, even if training succeeded.',
      },
      {
        term: 'Model Server',
        text: 'The process that answers predictions. Red leaves training untouched but takes live endpoints down.',
      },
    ],
    steps: [
      {
        title: 'Reload once',
        body: 'Health is read at page load. A dot can be red because of a moment that has already passed.',
      },
      {
        title: 'If Backend is red, wait',
        body: 'No useful work can be done until it returns. Reload in a minute rather than retrying a form.',
      },
      {
        title: 'If only Model Server is red, carry on training',
        body: 'Runs, data, and registration all still work. Predictions do not. Tell your administrator; nothing in your project will repair it.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Health is about the platform, not your project',
        body: 'A perfectly healthy platform with an empty project looks exactly like this. Empty is not broken.',
      },
      {
        tone: 'watch',
        title: 'A dot is not a diagnosis',
        body: 'It says “not reachable from the app”, not why. The reason lives in the platform’s own logs, which is an administrator’s job.',
      },
    ],
  },

  {
    id: 'recent-runs',
    chapter: 'home',
    nav: 'Recent pipelines',
    title: 'The last five runs',
    keywords: ['runs', 'recent', 'pipelines', 'status', 'success', 'failed', 'queued', 'duration', 'commit'],
    lede: 'One row per run, newest first. Every row is a link to the record; the table is a doorway, not a report.',
    wireframe: <RecentRunsScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Pipeline',
        text: 'The run’s short id. Click it to open phases, logs, the advisor, and metrics.',
      },
      {
        n: 2,
        label: 'Repository',
        text: 'The repository the notebook came from — the name half of its GitHub URL.',
      },
      {
        n: 3,
        label: 'Commit',
        text: 'The first seven characters of the commit that ran. This is how two runs of the same code are told apart.',
      },
      {
        n: 4,
        label: 'Status',
        text: 'Queued, running, success, or failed. Running pulses; the rest are still.',
      },
      {
        n: 5,
        label: 'Started',
        text: 'Local time, to the minute. Runs are ordered by this, not by when they finished.',
      },
      {
        n: 6,
        label: 'Duration',
        text: 'Finish minus start. A run still going shows the time so far, updating on each refresh.',
      },
    ],
    fields: [
      {
        term: 'Queued',
        text: 'Accepted and waiting for a worker. Nothing is wrong; waits are usually short.',
      },
      {
        term: 'Running',
        text: 'The notebook is executing. The page refreshes faster while something is active.',
      },
      {
        term: 'Success',
        text: 'Every phase passed. A model was registered — and deployed only if the accuracy gate allowed it.',
      },
      {
        term: 'Failed',
        text: 'A phase stopped. Open the run; the first red phase is the one to read, not the last.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'A failed run is still useful',
        body: 'Its logs and metrics remain. Regenerate the advisor’s report after fixing the cause; the comparison is the point.',
      },
      {
        tone: 'watch',
        title: 'The table is not the archive',
        body: 'It shows five. Use the run list on the pipeline canvas for the last fifteen of a repository, or the run URL if someone shared it.',
      },
    ],
  },

  {
    id: 'metrics',
    chapter: 'home',
    nav: 'Model metrics',
    title: 'Metrics that move over time',
    keywords: ['grafana', 'metrics', 'charts', 'accuracy', 'drift', 'traffic', 'platform', 'my models', 'refresh'],
    lede: 'Two embedded dashboards sit below the runs. Use them for trends and traffic; use a run page for one run’s numbers.',
    wireframe: <MetricsScreen />,
    anatomy: [
      {
        n: 1,
        label: 'My Models / Platform',
        text: 'Two tabs. Platform is for administrators only; if you do not see it, that is why.',
      },
      {
        n: 2,
        label: 'The panels',
        text: 'Accuracy over time, training runs, and inference traffic. The range is the last 30 days.',
      },
      {
        n: 3,
        label: 'Automatic refresh',
        text: 'The panels refresh every 30 seconds. You do not need to reload the page.',
      },
      {
        n: 4,
        label: 'Open in Grafana',
        text: 'Opens the same dashboard in a new tab, full screen, where it can be shared or inspected.',
      },
    ],
    fields: [
      {
        term: 'My Models',
        text: 'Training and inference for the models you own. The default tab, and the one to use day to day.',
      },
      {
        term: 'Platform',
        text: 'Cluster-wide health of the platform services. Administrative view; not about a single model.',
      },
      {
        term: 'Last 30 days',
        text: 'The default window. Changing it inside the embed is temporary; the app always opens on 30 days.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'A blank panel is a session problem',
        body: 'If the frame says it could not load the dashboard, the embedded Grafana session has expired. Reload the Dashboard or use Open in Grafana. Your run data is unaffected.',
      },
      {
        tone: 'tip',
        title: 'Panels are not live per-run',
        body: 'They read the platform’s records on a 30-second cycle. A run that finished seconds ago may take one refresh to appear.',
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  03 — Projects and data                                           */
  /* ---------------------------------------------------------------- */
  {
    id: 'projects',
    chapter: 'data',
    nav: 'Projects',
    title: 'Projects, the unit of work',
    keywords: ['projects', 'new project', 'create', 'name', 'cards', 'sources', 'gold rows', 'repository'],
    lede: 'A project holds one line of work: its data, the notebook that trains on it, and the models that come out. Everything else in Maia hangs off a project.',
    wireframe: <ProjectsScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Name your project',
        text: 'The only field. Choose something that will still make sense in six months; there is no rename control in the interface.',
      },
      {
        n: 2,
        label: 'New project',
        text: 'Creates it and adds a card below. Disabled while the name is empty.',
      },
      {
        n: 3,
        label: 'Project card',
        text: 'Opens the project. The repository line says “No repository linked yet” until code is attached — not an error.',
      },
      {
        n: 4,
        label: 'Sources',
        text: 'How many external systems are connected. Uploaded files are counted separately, under Data.',
      },
      {
        n: 5,
        label: 'Rows in gold',
        text: 'The size of the table training will read. Zero until the first gold build exists.',
      },
    ],
    steps: [
      {
        title: 'Name it and create it',
        body: 'One field, one button. The project opens with a Data Factory and nothing else.',
      },
      {
        title: 'Decide where to start',
        body: 'Data first is the common path. Code first is also fine: link a repository now and connect data later.',
      },
      {
        title: 'Open the card to work',
        body: 'The card is the only way in. It shows enough to choose between projects without opening all of them.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'A card with no code is a normal card',
        body: 'It means the data work has started first, which is deliberate. Nothing is missing.',
      },
      {
        tone: 'watch',
        title: 'No delete here',
        body: 'Projects cannot be renamed or deleted from this screen. Ask an administrator if one has to go.',
      },
    ],
  },

  {
    id: 'project-page',
    chapter: 'data',
    nav: 'Inside a project',
    title: 'Two halves: data, then code',
    keywords: ['project', 'detail', 'data factory', 'repository', 'link', 'overview'],
    lede: 'The project page is a table of contents with two entries. Data comes first because it comes first in the work — and because a project can have all of it without a repository.',
    wireframe: <ProjectScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Data Factory',
        text: 'The large card. Opens the seven-stage path from connection to dashboard.',
      },
      {
        n: 2,
        label: 'Sources',
        text: 'A live count. Zero is a valid starting point, not a warning.',
      },
      {
        n: 3,
        label: 'Rows in gold',
        text: 'The one number that says whether there is something to train on.',
      },
      {
        n: 4,
        label: 'Repository',
        text: 'The code half. “Link a repository” opens the picker; once linked, the card shows the branch, the notebook, and Open pipeline.',
      },
    ],
    fields: [
      {
        term: 'Link a repository',
        text: 'Attaches code to the project. Optional, reversible, and unrelated to the data already collected.',
      },
      {
        term: 'Open pipeline',
        text: 'Appears only when a repository is linked. Goes to the canvas where runs are started.',
      },
      {
        term: 'Unlink',
        text: 'Removes the code connection. The data, gold builds, and past runs stay exactly where they are.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Work top to bottom on a first visit',
        body: 'Open the Data Factory, connect something, run an extraction. Then come back for the repository once there is a table worth training on.',
      },
    ],
  },

  {
    id: 'link-repo',
    chapter: 'data',
    nav: 'Linking a repository',
    title: 'Repository, branch, notebook — in that order',
    keywords: ['repository', 'repo', 'github', 'link', 'branch', 'notebook', 'ipynb', 'choose'],
    lede: 'Linking code is three choices, not a form. Maia reads GitHub directly, so it asks for the repository, the branch, and the one notebook that trains.',
    wireframe: <LinkRepoScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Repository',
        text: 'Pick one from the registered list. “Explore” becomes “Selected”; the panel below opens.',
      },
      {
        n: 2,
        label: 'Branch',
        text: 'Loaded from GitHub. This is the branch whose notebook is fetched for every run.',
      },
      {
        n: 3,
        label: 'Notebook',
        text: 'Only .ipynb files in that branch. The list reloads when the branch changes.',
      },
      {
        n: 4,
        label: 'Link selected notebook',
        text: 'Disabled until a notebook is chosen. Linking replaces any previous selection.',
      },
    ],
    steps: [
      {
        title: 'Register a repository first, if the list is empty',
        body: (
          <>
            The picker offers <Ui>Add one</Ui>, which goes to My Repos. There you paste a
            GitHub URL and a personal access token.
          </>
        ),
      },
      {
        title: 'Choose the repository',
        body: 'The list shows the name and its default branch. Selecting it loads branches from GitHub.',
      },
      {
        title: 'Choose the branch',
        body: 'A branch that no longer exists will error rather than silently fall back. Pick another.',
      },
      {
        title: 'Choose the notebook and link it',
        body: 'The path is stored on the project. From then on, the canvas and every run use this file on this branch.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'The notebook must carry the tags',
        body: 'Linking accepts any .ipynb, but a run will fail validation if config, preprocessing, training, or export is missing. See Notebook requirements.',
      },
      {
        tone: 'tip',
        title: 'Changing branch later',
        body: 'Unlink the repository on the project page, then link it again with another branch. Past runs keep the branch they actually used.',
      },
    ],
  },

  {
    id: 'data-factory',
    chapter: 'data',
    nav: 'The Data Factory',
    title: 'Seven stages, one direction',
    keywords: ['data factory', 'stages', 'map', 'connect', 'preview', 'extract', 'bronze', 'silver', 'gold', 'kpi'],
    lede: 'The Data Factory is the path data takes, drawn as stages. It is also the navigation: click any stage you have reached, in any order.',
    wireframe: <StagesScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Connect',
        text: 'A database, or files you upload. Always open.',
      },
      {
        n: 2,
        label: 'Preview',
        text: 'A live read of a handful of rows from each source. Nothing is stored.',
      },
      {
        n: 3,
        label: 'Extract',
        text: 'Choose one source and bring its rows in. This is what writes bronze.',
      },
      {
        n: 4,
        label: 'Bronze',
        text: 'Exactly what the source said, with a row count. Fills on the first extraction.',
      },
      {
        n: 5,
        label: 'Silver',
        text: 'Cleaned and typed, with a report of what changed. Also filled by extraction.',
      },
      {
        n: 6,
        label: 'Gold',
        text: 'The versioned table training reads. Its badge is the current version, e.g. v4.',
      },
      {
        n: 7,
        label: 'KPI maker',
        text: 'Not about data arriving: a dashboard built over gold. Reachable once gold exists.',
      },
    ],
    steps: [
      {
        title: 'Start where you left off',
        body: 'The factory opens on the furthest stage you have reached, not on stage one. A returning user is not sent back to Connect.',
      },
      {
        title: 'Use the badges as the state',
        body: 'Source count, row counts, gold version. A stage with a badge has something in it.',
      },
      {
        title: 'Read the grey text on a locked stage',
        body: 'It names the action that unlocks it: “Connect a source first”, “Run an extraction”, “Build silver first”, “Build gold first”.',
      },
      {
        title: 'Leave KPI maker for a question',
        body: 'It is never opened by default, even when gold exists. It answers something; it does not complete the data.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Bronze and silver are not separate jobs',
        body: 'One extraction produces both. There is no “clean the data” button — the cleaning rules are applied on the way in.',
      },
      {
        tone: 'watch',
        title: 'A stage can be reached and empty',
        body: 'After deleting a source, counts can drop. The map follows the records, so it may show less than you remember.',
      },
    ],
  },

  {
    id: 'connect',
    chapter: 'data',
    nav: 'Connecting data',
    title: 'Two ways in: a source or a file',
    keywords: ['connect', 'upload', 'database', 'postgres', 'mysql', 'csv', 'parquet', 'json', 'xlsx', 'sql', 'watermark', 'credentials'],
    lede: 'A database Maia reads, or a file you hand it. Both end up in bronze, and both become the input a notebook can train on.',
    wireframe: <ConnectScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Add source',
        text: 'Opens the connection form. “Connect” is the stage; “Add source” is the button.',
      },
      {
        n: 2,
        label: 'Password environment variable',
        text: 'The name of a variable on the worker, not the password. No credential passes through this form.',
      },
      {
        n: 3,
        label: 'Extraction query',
        text: 'The SQL that selects rows. It must reference :watermark and return the watermark column.',
      },
      {
        n: 4,
        label: 'Preview data / Connect source',
        text: 'Preview reads live rows and stores nothing. Connect saves the source and unlocks Preview and Extract.',
      },
      {
        n: 5,
        label: 'Upload dataset',
        text: 'Drag a file or browse. CSV, Parquet, JSON, JSON Lines, and Excel are accepted. Description is optional.',
      },
    ],
    fields: [
      {
        term: 'Name',
        text: 'What you will recognise it by later, e.g. “Hospital HIS”. It appears in the source list and in run history.',
      },
      {
        term: 'Host / Database / Username',
        text: 'Where the system lives and who reads it. The password is supplied separately, by variable name.',
      },
      {
        term: 'Extraction query',
        text: 'Must contain :watermark. Without it, every extraction would re-read the whole source instead of only what is new.',
      },
      {
        term: 'Watermark column',
        text: 'When the row was recorded, not when the event happened. This is the column Maia advances after each extraction.',
      },
      {
        term: 'Text / code columns',
        text: 'Optional hints for silver’s normalisation: which free-text field to clean, which coded field to standardise.',
      },
      {
        term: 'Upload',
        text: 'The file becomes the project’s active dataset. Uploading another replaces the active one; earlier files remain under all builds.',
      },
    ],
    steps: [
      {
        title: 'Choose the door',
        body: 'A system that already holds the data → Add source. A file on your machine → Upload dataset.',
      },
      {
        title: 'Preview before you commit',
        body: 'Preview runs the query against the real database and shows columns and inferred types. It is read-only.',
      },
      {
        title: 'Connect or upload',
        body: 'Connecting saves the source. Uploading stores the file and marks it active for the next run.',
      },
      {
        title: 'Go to Extract',
        body: 'A connected source is not extracted automatically. Choose it on the Extract stage and start the read.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'A preview with no rows is not a failure',
        body: 'It means the connection worked and the query returned nothing. Widen the query or check the watermark before extracting.',
      },
      {
        tone: 'tip',
        title: 'One active dataset',
        body: 'Only one uploaded file is active at a time. “All builds” under Gold shows the rest and lets you choose which the next run mounts.',
      },
    ],
  },

  {
    id: 'layers',
    chapter: 'data',
    nav: 'Bronze, silver, gold',
    title: 'The same rows, three promises',
    keywords: ['medallion', 'bronze', 'silver', 'gold', 'layers', 'cleaning', 'duplicates', 'quality', 'version', 'builds'],
    lede: 'Bronze, silver, and gold are not folders. They are three answers to “what is in here?” — and only the last one is what training reads.',
    extra: <LayersBlock />,
    fields: [
      {
        term: 'Active build',
        text: 'The gold version the next pipeline run mounts by default. Chosen under All builds; one at a time.',
      },
      {
        term: 'All builds',
        text: 'Every gold table ever produced for the project, with row counts. Reachable from the Gold stage.',
      },
      {
        term: 'Version',
        text: 'v1, v2, v3… A rebuild writes a new version rather than overwriting the old one, so comparisons remain possible.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Row counts are supposed to move',
        body: 'Silver drops duplicate and unparseable rows, so it is often smaller than bronze. Gold can be smaller still, because it is one row per entity rather than one per event.',
      },
      {
        tone: 'watch',
        title: 'Gold is a query, not a cleaning step',
        body: 'If a number looks wrong in gold, the definition is the place to look — not the source. The Gold stage shows and edits that definition.',
      },
    ],
  },

  {
    id: 'kpi-maker',
    chapter: 'data',
    nav: 'KPI maker',
    title: 'Ask for a dashboard',
    keywords: ['kpi', 'superset', 'dashboard', 'chart', 'agent', 'ask', 'report', 'visualisation'],
    lede: 'The final stage is a conversation. Describe what you want to see and Maia builds it in Superset over gold, one chart at a time.',
    wireframe: <KpiScreen />,
    anatomy: [
      {
        n: 1,
        label: 'The dashboard',
        text: 'Rendered above the conversation once something exists. Open Superset ↗ for the full editor.',
      },
      {
        n: 2,
        label: 'Your request',
        text: 'The prompt and the agent’s plain-language answer. “Show what it did” lists every call it made.',
      },
      {
        n: 3,
        label: 'What should change?',
        text: 'The follow-up box. It edits the dashboard it already built instead of starting a second one.',
      },
      {
        n: 4,
        label: 'Send',
        text: 'Applies the change. The first submission is labelled Build it instead.',
      },
    ],
    steps: [
      {
        title: 'Describe the question, not the chart type',
        body: '“Encounters per month, split by class, with average cost alongside” gives the agent more to work with than “bar chart”.',
      },
      {
        title: 'Read what it says it built',
        body: 'The summary names the charts and the split. If it misunderstood, say so before adding more.',
      },
      {
        title: 'Iterate in the same conversation',
        body: '“Make the second chart a line.” “Only the last two years.” Each turn refines the same dashboard.',
      },
      {
        title: 'Open Superset when you need the editor',
        body: 'The embed is for asking and checking. Superset itself is for layout, sharing, and anything the agent does not do.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'It can run out of turns',
        body: 'The agent says so explicitly, and the dashboard may be incomplete. Ask it to carry on; do not assume the half-built version is final.',
      },
      {
        tone: 'tip',
        title: 'Gold only',
        body: 'The KPI maker queries gold. If the numbers need to change, change the gold definition and rebuild — not the chart.',
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  04 — Pipelines                                                   */
  /* ---------------------------------------------------------------- */
  {
    id: 'pipeline-canvas',
    chapter: 'pipelines',
    nav: 'The pipeline canvas',
    title: 'One row: input, phases, model',
    keywords: ['pipeline', 'canvas', 'input', 'phases', 'nodes', 'notebook', 'drag', 'data', 'runs'],
    lede: 'The canvas answers the question a log cannot: which data went into which code. The input is chosen by hand; every phase opens to the code it ran.',
    wireframe: <CanvasScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Run pipeline',
        text: 'Starts the notebook on the input shown. Disabled while any run of this repository is queued or running.',
      },
      {
        n: 2,
        label: 'Input',
        text: 'The data this run will mount: the active dataset, or a bronze, silver, or gold build.',
      },
      {
        n: 3,
        label: 'Phase cards',
        text: 'One per tagged cell. Each shows whether it ran, failed, or never ran in the selected run.',
      },
      {
        n: 4,
        label: 'Model',
        text: 'Accuracy and deployment for the run. A model can be registered without being deployed.',
      },
      {
        n: 5,
        label: 'Data',
        text: 'Every input you can mount. Click to preview rows; drag onto Input to use.',
      },
      {
        n: 6,
        label: 'Runs',
        text: 'The last fifteen runs of this repository, newest first. Selecting one redraws the cards.',
      },
    ],
    fields: [
      {
        term: 'Active dataset',
        text: 'The uploaded file currently marked active for the project. The default input for a project without a medallion build.',
      },
      {
        term: 'Bronze / Silver / Gold',
        text: 'Specific medallion builds. Choosing one overrides the active dataset for every subsequent run of this repository, until changed.',
      },
      {
        term: 'Branch run',
        text: 'The entry at the top of the Runs list. It is not a run: it is the notebook currently on the branch, shown before a first run or when selecting the branch itself.',
      },
    ],
    steps: [
      {
        title: 'Choose the input',
        body: 'Click a row in Data to preview it, then choose “Use this” in the preview — or drag it onto the Input card.',
      },
      {
        title: 'Click a card to inspect it',
        body: 'Every phase opens to its code and its printed output. The input and model cards open to their own detail.',
      },
      {
        title: 'Select an older run in Runs',
        body: 'The row redraws as that run: its commit, its phases, its model. The input card also shows what that run mounted.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'The canvas is per repository',
        body: 'A project has one linked repository, so it has one canvas. Selecting a run does not change the input for future runs.',
      },
      {
        tone: 'watch',
        title: 'One run at a time',
        body: 'The button reads Running. while this repository has a queued or running pipeline. Other projects are unaffected.',
      },
    ],
  },

  {
    id: 'running',
    chapter: 'pipelines',
    nav: 'Running a pipeline',
    title: 'Starting a run, and what happens next',
    keywords: ['run pipeline', 'start', 'trigger', 'push', 'webhook', 'queued', 'running', 'wait', 'queue'],
    lede: 'A run executes the notebook as it exists on GitHub, on the input shown. It takes minutes rather than seconds, and it is safe to leave the page.',
    steps: [
      {
        title: 'Check the input card',
        body: 'It names exactly what will be mounted: “gold v4”, the active dataset, and so on. If it is wrong, change it before running.',
      },
      {
        title: 'Choose Run pipeline',
        body: 'The run is accepted immediately and shows as queued. A worker picks it up; then the status becomes running.',
      },
      {
        title: 'Follow it on the run page',
        body: 'Phases turn as the worker moves through them, and logs stream while the run is active. The browser can be closed.',
      },
      {
        title: 'Read the result',
        body: 'Success or failure, with metrics and (if allowed) a deployment. The run also appears at the top of Runs and on the Dashboard.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Pushing can start a run too',
        body: 'A push that changes the notebook on the linked branch triggers a run through the repository’s webhook. Use Run pipeline to repeat the same commit without an empty commit.',
      },
      {
        tone: 'watch',
        title: 'The button is disabled for a reason',
        body: 'It means this repository already has a run queued or running. Wait for it; starting a second would only compete for the same worker.',
      },
    ],
  },

  {
    id: 'run-detail',
    chapter: 'pipelines',
    nav: 'Reading a run',
    title: 'The record of one run',
    keywords: ['run', 'detail', 'logs', 'phases', 'download', 'validate', 'execute', 'register', 'deploy', 'failed', 'metrics'],
    lede: 'The run page is the evidence: which commit ran, what each phase did, what was printed, and what the advisor made of it.',
    wireframe: <RunScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Header',
        text: 'Run id, repository, branch, and commit. Branch testing-ia-agent is highlighted — it means the code came from the advisor.',
      },
      {
        n: 2,
        label: 'Pipeline phases',
        text: 'Download, validate, execute, register, deploy. A phase is pending, running, successful, or failed.',
      },
      {
        n: 3,
        label: 'Logs',
        text: 'Live over a WebSocket while the run is active; read from storage once it finishes.',
      },
      {
        n: 4,
        label: 'AI Training Advisor',
        text: 'The report for this run. Analyze this run asks for a new one; Apply & push rewrites the notebook.',
      },
      {
        n: 5,
        label: 'Metrics',
        text: 'The run’s numbers compared with earlier runs of the same repository.',
      },
      {
        n: 6,
        label: 'Deployed model',
        text: 'Only present when the run deployed. Contains a ready-to-run prediction request.',
      },
    ],
    fields: [
      {
        term: 'Download',
        text: 'Fetches the notebook at the commit and mounts the chosen data. Fails on missing repository access or a missing file.',
      },
      {
        term: 'Validate',
        text: 'Checks the four required tags. This is where “missing MLOps tags” stops the run.',
      },
      {
        term: 'Execute',
        text: 'Papermill runs the notebook with DATASET_PATH and MODEL_OUTPUT_PATH injected. A Python error surfaces here.',
      },
      {
        term: 'Register',
        text: 'Records the exported artifact and metrics in MLflow. A success without a model means export did not write the file.',
      },
      {
        term: 'Deploy',
        text: 'Runs only if auto-deploy is on and accuracy meets the threshold. Skipping is reported as a reason, not a failure.',
      },
    ],
    steps: [
      {
        title: 'Find the first red phase',
        body: 'Read it from left to right. Later phases are usually pending, not additional failures.',
      },
      {
        title: 'Open that phase’s logs',
        body: 'The phase timestamp tells you when it broke. The last lines of its output usually name the cause.',
      },
      {
        title: 'Fix, push, run again',
        body: 'Commit the notebook change, then run from the canvas. A new run gets a new id; the old one stays as the record.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'A run can fail before the notebook',
        body: 'If every card says “never ran”, the failure was in download or validate. The reason is a banner above the phase row instead.',
      },
      {
        tone: 'tip',
        title: 'Runs predating code capture',
        body: 'Older runs may show today’s branch code instead of the code that actually ran. The page says so; trust the commit, not the card.',
      },
    ],
  },

  {
    id: 'notebook',
    chapter: 'pipelines',
    nav: 'Notebook requirements',
    title: 'The four tags that make a notebook runnable',
    keywords: ['notebook', 'tags', 'mlops', 'config', 'preprocessing', 'training', 'export', 'joblib', 'papermill', 'contract'],
    lede: 'Maia does not read a notebook like a person. It looks for four tags and runs exactly those cells, in a fixed order. Everything else is ignored.',
    extra: <NotebookBlock />,
    notes: [
      {
        tone: 'tip',
        title: 'Keep the fallbacks',
        body: (
          <>
            A cell that reads <code>DATASET_PATH</code> should still work when the variable is
            missing, so the notebook remains runnable on a laptop. Maia never asks you to
            remove that fallback.
          </>
        ),
      },
      {
        tone: 'watch',
        title: 'The model must reach disk',
        body: (
          <>
            The export cell has to call <code>joblib.dump(model, MODEL_OUTPUT_PATH)</code>. A
            model that exists only in memory cannot be registered, and the run will look
            successful while deploying nothing.
          </>
        ),
      },
    ],
  },

  {
    id: 'advisor',
    chapter: 'pipelines',
    nav: 'AI Training Advisor',
    title: 'A second reader for every run',
    keywords: ['advisor', 'ai', 'insights', 'analyze', 'suggestions', 'apply', 'push', 'testing-ia-agent', 'improve'],
    lede: 'After a run, the advisor reads the notebook and its metrics and writes what to change next, in plain language. It can also make the change — on a branch, never on yours.',
    wireframe: <AdvisorScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Analyze this run',
        text: 'Asks for a report. If one exists, the button reads Regenerate analysis and replaces it.',
      },
      {
        n: 2,
        label: 'The report',
        text: 'Findings about the code, the data, and the numbers, written for a person who owns the notebook.',
      },
      {
        n: 3,
        label: 'Apply & push',
        text: 'Rewrites the notebook with the report’s recommendations and pushes it to testing-ia-agent.',
      },
      {
        n: 4,
        label: 'Confirmation',
        text: 'Branch name and commit, once the push lands. Review the diff on GitHub before training on it.',
      },
    ],
    steps: [
      {
        title: 'Let it run on its own',
        body: 'When the platform is configured for it, the first analysis starts as soon as the pipeline finishes. Nothing to click.',
      },
      {
        title: 'Ask again after a change',
        body: 'Regenerate after fixing a run or changing data. The advisor reads the current record, not the old one.',
      },
      {
        title: 'Apply, then review in GitHub',
        body: (
          <>
            <Ui>Apply &amp; push</Ui> preserves the required tags and the export dump. It
            creates or resets <code>testing-ia-agent</code> from the run’s branch, so your
            working branch is untouched.
          </>
        ),
      },
      {
        title: 'Train on the improved code deliberately',
        body: 'Merge the branch into your working branch and push — or relink the project to testing-ia-agent and run from there. Pushing alone does not retrain unless it is the linked branch.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'The advisor reads three things',
        body: 'The notebook source, the metrics from the run, and the repository’s recent history. That is why a report improves when earlier runs exist.',
      },
      {
        tone: 'watch',
        title: 'A second opinion is not a merge',
        body: 'The report can be wrong about your domain. Read the diff before merging; the branch is a proposal, not a promotion.',
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  05 — Models and account                                          */
  /* ---------------------------------------------------------------- */
  {
    id: 'models',
    chapter: 'account',
    nav: 'Models',
    title: 'What is deployed, and how to test it',
    keywords: ['models', 'deploy', 'endpoint', 'predict', 'test', 'rollback', 'delete', 'version', 'accuracy', 'inference'],
    lede: 'Models is the deployment register. A row appears only after a successful run deploys; from here you can call it, roll it back, or remove it.',
    wireframe: <ModelsScreen />,
    anatomy: [
      {
        n: 1,
        label: 'The table',
        text: 'Every model the platform is serving, newest deployments first. Refreshes every 15 seconds.',
      },
      {
        n: 2,
        label: 'Status',
        text: 'Active means this version is the one answering. A model being rolled back is briefly inactive.',
      },
      {
        n: 3,
        label: 'Endpoint',
        text: 'The path predictions are sent to. The copy button copies the full URL.',
      },
      {
        n: 4,
        label: 'Actions',
        text: 'Test, Rollback, Delete. The first is read-safe; the other two ask for confirmation.',
      },
    ],
    fields: [
      {
        term: 'Version',
        text: 'Comes from the config cell. Deploying the same name again adds a version and makes it active.',
      },
      {
        term: 'Accuracy',
        text: 'The metric recorded at registration, as a percentage. It is the value the deployment gate used.',
      },
      {
        term: 'Rollback',
        text: 'Makes the previous version active again. The newer version remains in the record; it is not deleted.',
      },
      {
        term: 'Delete',
        text: 'Unloads the model from the model server and removes it from this list. Confirm only when you mean it.',
      },
    ],
    steps: [
      {
        title: 'Choose Test on the row',
        body: 'A modal opens with a JSON payload already filled in — one sample row, shaped like the training data.',
      },
      {
        title: 'Replace the sample with a real row',
        body: 'Keep the shape: a “data” array of arrays. Feature order must match training, or the prediction is meaningless even when it returns.',
      },
      {
        title: 'Send the request',
        body: 'The response shows the prediction, or the server’s error. A validation error here is about the payload, not the model.',
      },
      {
        title: 'Read the endpoint, do not open it',
        body: 'It is a POST endpoint for programs. A browser visit sends GET and will error even on a healthy model.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'A model can be registered and not deployed',
        body: 'The run page says which. Deployment needs auto-deploy enabled and accuracy at or above the platform threshold.',
      },
      {
        tone: 'watch',
        title: 'Deleting is how you free a name',
        body: 'Deleting removes the served model, not the training history in MLflow. You can always deploy again from a later run.',
      },
    ],
  },

  {
    id: 'settings',
    chapter: 'account',
    nav: 'Your account',
    title: 'Changes that need a second click',
    keywords: ['settings', 'account', 'email', 'password', 'username', 'change', 'confirm', 'security'],
    lede: 'Three tabs, one rule: nothing changes until you open the link Maia emails you. The delay is the point — it proves the request came from you.',
    wireframe: <SettingsScreen />,
    anatomy: [
      {
        n: 1,
        label: 'Email / Password / Username',
        text: 'Three tabs, one form each. Switching tabs does not save anything.',
      },
      {
        n: 2,
        label: 'The field',
        text: 'The current value, or the new one. A password change asks for the current password as well.',
      },
      {
        n: 3,
        label: 'Update button',
        text: 'The label follows the tab: Update email, Change password, Change username.',
      },
      {
        n: 4,
        label: 'Confirmation notice',
        text: '“Check your email.” The change is pending until the link is opened.',
      },
    ],
    fields: [
      {
        term: 'Email',
        text: 'Confirmation goes to the address already on the account — that is how a change is proven. A brand-new account receives it at the address being added.',
      },
      {
        term: 'Password',
        text: 'Needs the current password. The new one must be 8–72 characters. Both are cleared after the request.',
      },
      {
        term: 'Username',
        text: 'The new name must be free. Your current username is shown read-only above the form.',
      },
    ],
    steps: [
      {
        title: 'Make the request',
        body: 'Fill the form and submit. The screen changes to a confirmation notice; the change has not happened yet.',
      },
      {
        title: 'Open the link in the email',
        body: 'It lands on a confirmation page. That click applies the change and invalidates any earlier pending request of the same kind.',
      },
      {
        title: 'Sign in again if you changed a credential',
        body: 'For a password or username change, use the new value. The old one stops working the moment the link is confirmed.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'The link expires, and only the latest works',
        body: 'Requesting the same change twice invalidates the first link. If both emails are open, use the newest.',
      },
      {
        tone: 'tip',
        title: 'Email first',
        body: 'If the account has no email yet, set one before relying on confirmations for anything else.',
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /*  06 — Help                                                        */
  /* ---------------------------------------------------------------- */
  {
    id: 'faq',
    chapter: 'help',
    nav: 'Questions we get',
    title: 'Short answers',
    keywords: ['faq', 'questions', 'help', 'how', 'can i', 'push', 'deploy', 'two people', 'delete'],
    lede: 'The questions that come up often enough to answer before they are asked.',
    qa: [
      {
        q: 'Do I need a GitHub repository to start?',
        a: 'No. A project is useful with data alone: connect, extract, clean, build gold. Code is attached when there is something to train.',
      },
      {
        q: 'Can Maia use a notebook from any repository?',
        a: 'Any repository registered in My Repos that the platform’s GitHub token can read. The notebook must be a .ipynb on a branch reachable from GitHub, and it must carry the four required tags.',
      },
      {
        q: 'What exactly starts a run?',
        a: 'Two things: Run pipeline on the canvas, and a push that changes the notebook on the linked branch. Pushes to other branches or other files are ignored.',
      },
      {
        q: 'Where do I find an old run?',
        a: 'The Dashboard keeps the five newest across all projects. The canvas keeps the last fifteen for its repository. A run URL keeps working indefinitely.',
      },
      {
        q: 'Does every successful run deploy a model?',
        a: 'No. Deployment also needs auto-deploy enabled and accuracy at or above the platform threshold. The deploy phase records the reason when it skips.',
      },
      {
        q: 'Can I change the data for one run only?',
        a: 'Choosing an input on the canvas changes it for subsequent runs of that repository, not for one run. Change it back when the experiment is over.',
      },
      {
        q: 'Can two people train at the same time?',
        a: 'Yes, across repositories and projects. Within one repository, one run at a time — the button is disabled while something is queued or running.',
      },
      {
        q: 'What does the gold version number mean?',
        a: 'Each rebuild writes a new version: v1, v2, and so on. The active build is the one the next run mounts by default. Old versions are kept for comparison.',
      },
      {
        q: 'Are database passwords stored in Maia?',
        a: 'No. A source records the name of an environment variable on the worker. The password itself is neither sent from the form nor stored in the database.',
      },
      {
        q: 'How do I get an account, or give someone else one?',
        a: 'An administrator sends an invitation from Admin. The link is single-use, expires, and opens the registration page.',
      },
      {
        q: 'Can I rename or delete a project?',
        a: 'There is no control for either in the interface yet. Ask an administrator. Unlinking a repository, by contrast, is yours to do and keeps all the data.',
      },
    ],
  },

  {
    id: 'issues',
    chapter: 'help',
    nav: 'When something looks wrong',
    title: 'Symptom, cause, action',
    keywords: ['troubleshooting', 'error', 'failed', 'stuck', 'blank', 'broken', 'fix', 'support'],
    lede: 'The ten situations that account for most “it is not working” moments, and the shortest route out of each.',
    extra: <IssuesTable />,
    notes: [
      {
        tone: 'tip',
        title: 'If this manual and the screen disagree',
        body: 'Trust the screen, then tell whoever maintains Maia. A manual that stays wrong is worse than one with a gap.',
      },
    ],
  },
];

/** The chapter a section belongs to, for its eyebrow and contents grouping. */
export function chapterOf(section: ManualSection): ManualChapter {
  return CHAPTERS.find((chapter) => chapter.id === section.chapter) ?? CHAPTERS[0];
}
