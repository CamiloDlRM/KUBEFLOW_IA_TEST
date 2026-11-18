import type { ReactNode } from 'react';
import {
  ConnectScreen,
  KpiScreen,
  SettingsScreen,
  ShellScreen,
  StagesScreen,
} from '../components/docs/Wireframes';
import {
  IssuesTable,
  LayersBlock,
  NotebookBlock,
  ScreenshotFrame,
} from '../components/docs/ManualBlocks';
import loginImg from '../assets/UI_PF/Login.png';
import signUpImg from '../assets/UI_PF/sing in.png';
import dashboardRecentImg from '../assets/UI_PF/Dashboard_recentPipelines.png';
import dashboardMyModelsImg from '../assets/UI_PF/Dashboard_My_models.png';
import dashboardPlatformImg from '../assets/UI_PF/Dashboard_Platform.png';
import dashboardResourcesImg from '../assets/UI_PF/Dashboard_Resources.png';
import projectsImg from '../assets/UI_PF/Projects.png';
import projectDetailImg from '../assets/UI_PF/Projects_new.png';
import linkRepoProjectImg from '../assets/UI_PF/Create_project.png';
import myReposImg from '../assets/UI_PF/Link_repo.png';
import pipelinesImg from '../assets/UI_PF/Pipelines.png';
import runPipelineImg from '../assets/UI_PF/Run_pipeline.png';
import modelsImg from '../assets/UI_PF/Models.png';
import runtimePipelineImg from '../assets/UI_PF/Runtime_Pipeline.png';
import medallionsImg from '../assets/UI_PF/Medallons.png';
import pipelineSetupImg from '../assets/UI_PF/Pipeline_Setup.png';
import pipelineConfigImg from '../assets/UI_PF/Pipeline_Config.png';
import pipelineDataImg from '../assets/UI_PF/Pipeline_Data.png';
import pipelinePreprocessingImg from '../assets/UI_PF/Pipeline_Preprocessing.png';
import pipelineTrainingImg from '../assets/UI_PF/Pipeline_Training.png';
import pipelineEvaluationImg from '../assets/UI_PF/Pipeline_Evaluation.png';
import pipelineExportImg from '../assets/UI_PF/Pipeline_export.png';
import pipelineModel1Img from '../assets/UI_PF/Pipeline_Model1.png';
import pipelineModel2Img from '../assets/UI_PF/pipeline_model2.png';
import pipelineFailedImg from '../assets/UI_PF/Pipeline_failed.png';
import pipelineAdvisorImg from '../assets/UI_PF/Pipeline-IA_Advisor.png';

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
    title: 'Signing in to Maia',
    keywords: ['login', 'log in', 'password', 'github', 'account', 'access', 'sign out'],
    lede: 'Sign in with your username and password, or continue directly with GitHub. Your session stays open until you explicitly sign out.',
    wireframe: (
      <ScreenshotFrame
        src={loginImg}
        path="maia / login"
        alt="Maia sign-in screen with Username, Password, Sign in button, and Continue with GitHub"
        caption="The sign-in screen: credentials or GitHub OAuth."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Username',
        text: 'Your Maia account username. It is not necessarily your email address.',
      },
      {
        n: 2,
        label: 'Password',
        text: 'Between 8 and 72 characters. Both fields are case-sensitive.',
      },
      {
        n: 3,
        label: 'Sign in',
        text: 'Opens the Dashboard. A wrong password says so without revealing which field was wrong.',
      },
      {
        n: 4,
        label: 'Continue with GitHub',
        text: 'Signs in using GitHub OAuth and links your GitHub identity for repository access.',
      },
      {
        n: 5,
        label: 'Sign up link',
        text: 'Switches to the account creation form if you do not have an account yet.',
      },
    ],
    steps: [
      {
        title: 'Open Maia and choose Sign in',
        body: 'The landing page links to the form, and the top-right Home button returns you to it.',
      },
      {
        title: 'Enter credentials or use GitHub',
        body: 'Use your username and password, or click Continue with GitHub to authenticate via OAuth.',
      },
    ],
    notes: [
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
    id: 'sign-up',
    chapter: 'start',
    nav: 'Creating an account',
    title: 'Creating an account',
    keywords: ['sign up', 'register', 'create account', 'github token', 'ghp', 'invite', 'new account'],
    lede: 'Create a Maia account from the Sign up form (or via an administrator invite link). Connecting a GitHub personal access token lets Maia list your repositories and trigger webhooks.',
    wireframe: (
      <ScreenshotFrame
        src={signUpImg}
        path="maia / sign up"
        alt="Maia create account form with Username, Email, GitHub token, Password, and Continue with GitHub"
        caption="Create account screen: local credentials plus optional GitHub personal access token."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Username & Email',
        text: 'Your unique handle in Maia and the email address used for notifications and credential confirmations.',
      },
      {
        n: 2,
        label: 'GitHub token (ghp_...)',
        text: 'A GitHub personal access token so Maia can browse branches, read notebooks, and register webhooks on your behalf.',
      },
      {
        n: 3,
        label: 'Password',
        text: 'Choose a password between 8 and 72 characters.',
      },
      {
        n: 4,
        label: 'Create account',
        text: 'Registers the account and signs you into the Dashboard.',
      },
      {
        n: 5,
        label: 'Continue with GitHub',
        text: 'Creates or links your account directly through GitHub OAuth without filling the form manually.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'Invitations expire',
        body: 'If your administrator sent an invitation link, it works once and expires after 24 hours to 7 days. Ask for a fresh one if it says the token is invalid or expired.',
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
            It lives at <code>/user-manual</code>, linked from the landing page, so it is not in the
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
    wireframe: (
      <ScreenshotFrame
        src={dashboardRecentImg}
        path="maia / dashboard"
        alt="Maia Dashboard showing sidebar navigation, Service Health indicators, and Recent Pipelines table"
        caption="Top of the Dashboard: sidebar navigation, Service Health status dots, and Recent Pipelines."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Service health',
        text: 'Four dots: Backend, Redis, MLflow, Model Server. Green means reachable at page load.',
      },
      {
        n: 2,
        label: 'Sidebar navigation',
        text: 'Always visible on the left: Dashboard, Projects, Pipelines, Models, My Repos, and Admin.',
      },
      {
        n: 3,
        label: 'Recent pipelines',
        text: 'The five newest runs across every project, showing Pipeline ID, Repository, User, Commit, Status, Started, and Duration.',
      },
      {
        n: 4,
        label: 'Model, Platform & Resource metrics',
        text: 'Embedded Grafana panels below the fold, split across three tabs: My Models, Platform, and Resources.',
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
        body: '“Is accuracy drifting?” belongs here. “What did run 028715c2 do?” belongs on the run page.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Runs start in Projects',
        body: (
          <>
            Open a project, then click <Ui>Run pipeline</Ui>. The Dashboard is
            deliberately read-only so a stray click cannot start compute.
          </>
        ),
      },
      {
        tone: 'watch',
        title: '“Recent” means five',
        body: 'Older runs are not hidden, just elsewhere: open Pipelines in the sidebar to search every run, or open the pipeline canvas for the last fifteen of a repository.',
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
    keywords: ['runs', 'recent', 'pipelines', 'status', 'success', 'failed', 'queued', 'duration', 'commit', 'user'],
    lede: 'One row per run, newest first. Every row links directly to the run record; the table is a quick doorway into your latest executions.',
    wireframe: (
      <ScreenshotFrame
        src={dashboardRecentImg}
        path="maia / dashboard · recent pipelines"
        alt="Recent Pipelines table on the Dashboard showing Pipeline ID, Repository, User, Commit, Status, Started, and Duration"
        caption="Recent Pipelines table: the five most recent notebook executions and their status badges."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Pipeline',
        text: 'The run’s short ID (e.g. 028715c2). Click it to open phases, logs, the advisor, and metrics.',
      },
      {
        n: 2,
        label: 'Repository & User',
        text: 'The GitHub repository owner/name that supplied the notebook and the user who triggered the run.',
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
        text: 'Local date and time, to the minute. Runs are ordered by this, not by when they finished.',
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
        body: 'It shows five. Use the Pipelines page in the sidebar for the full searchable history, or the pipeline canvas for the last fifteen of a repository.',
      },
    ],
  },

  {
    id: 'metrics',
    chapter: 'home',
    nav: 'Model metrics',
    title: 'Metrics that move over time: My Models',
    keywords: ['grafana', 'metrics', 'charts', 'accuracy', 'drift', 'traffic', 'my models', 'success rate', 'refresh'],
    lede: 'Below the recent runs sit three embedded Grafana dashboards that refresh every 30 seconds. The default tab, My Models, tracks training runs, accuracy over time, and deployment counts for the repositories you own.',
    wireframe: (
      <ScreenshotFrame
        src={dashboardMyModelsImg}
        path="maia / dashboard · my models"
        alt="Dashboard My Models tab showing My repositories, Deployed models, Last accuracy, Pipeline success rate, and Accuracy over time chart"
        caption="My Models tab: KPI counters and accuracy trends per repository and branch."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Dashboard tabs',
        text: 'Switch between My Models (your training & inference metrics), Platform (API & service telemetry), and Resources (host & container usage).',
      },
      {
        n: 2,
        label: 'Summary counters',
        text: 'Four headline numbers: My repositories, Deployed models, Last accuracy (%), and Pipeline success rate (%).',
      },
      {
        n: 3,
        label: 'Accuracy over time (per repository)',
        text: 'Plots validation accuracy across runs over the selected window (Last 30 days by default) so you can spot regressions or drift.',
      },
      {
        n: 4,
        label: 'Branch comparison & Pipeline outcomes',
        text: 'Compares accuracy between main and testing-ia-agent branches alongside run outcome breakdowns.',
      },
    ],
    fields: [
      {
        term: 'My Models',
        text: 'Training and inference metrics scoped to the models and repositories you own. The default tab for day-to-day work.',
      },
      {
        term: 'Last 30 days & 30s refresh',
        text: 'The default time window and auto-refresh interval inside the Grafana embed.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'A blank panel is a session problem',
        body: 'If the frame says it could not load the dashboard, the embedded Grafana session has expired. Reload the Dashboard; your run data is unaffected.',
      },
      {
        tone: 'tip',
        title: 'Panels are not live per-run',
        body: 'They read the platform’s records on a 30-second cycle. A run that finished seconds ago may take one refresh to appear.',
      },
    ],
  },

  {
    id: 'platform-metrics',
    chapter: 'home',
    nav: 'Platform metrics',
    title: 'Cluster-wide service telemetry: Platform',
    keywords: ['platform', 'grafana', 'scrape targets', 'requests', 'latency', '5xx', 'errors', 'endpoints', 'telemetry'],
    lede: 'The Platform tab shows cluster-wide HTTP traffic, latency percentiles, and scrape health across Maia’s backend and model-serving services.',
    wireframe: (
      <ScreenshotFrame
        src={dashboardPlatformImg}
        path="maia / dashboard · platform"
        alt="Dashboard Platform tab showing Scrape targets up, Requests/s, 5xx error ratio, p95 latency, Request rate by endpoint, and Latency percentiles"
        caption="Platform tab: Prometheus scrape targets, request throughput, error ratio, and p50/p90/p99 latency."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Scrape targets up',
        text: 'How many Prometheus targets in the MLOps stack are currently reachable and reporting metrics.',
      },
      {
        n: 2,
        label: 'Requests / s & 5xx error ratio',
        text: 'Real-time request throughput and the percentage of server-side (5xx) errors across the platform.',
      },
      {
        n: 3,
        label: 'p95 latency',
        text: '95th-percentile response time in milliseconds, useful for spotting slow API or inference calls.',
      },
      {
        n: 4,
        label: 'Request rate by endpoint & Latency percentiles',
        text: 'Time-series charts breaking down traffic per route and plotting p50, p90, and p99 response times.',
      },
    ],
  },

  {
    id: 'resource-metrics',
    chapter: 'home',
    nav: 'Resource metrics',
    title: 'Server and container usage: Resources',
    keywords: ['resources', 'cpu', 'memory', 'disk', 'containers', 'docker', 'network', 'grafana', 'host'],
    lede: 'The Resources tab monitors the physical or virtual host alongside every container in the stack (backend, worker, postgres, mlflow, minio, model-server, grafana).',
    wireframe: (
      <ScreenshotFrame
        src={dashboardResourcesImg}
        path="maia / dashboard · resources"
        alt="Dashboard Resources tab showing Host CPU used, Host memory used, Disk used, Containers running, CPU by container, and Memory by container"
        caption="Resources tab: host utilization gauges and per-container CPU, memory, and network time series."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Host CPU, Memory & Disk used',
        text: 'Overall server utilization percentages. High disk usage (above 80%) is a cue to prune old artifacts or container images.',
      },
      {
        n: 2,
        label: 'Containers running',
        text: 'Count of active containers in the Maia stack.',
      },
      {
        n: 3,
        label: 'CPU & Memory by container',
        text: 'Per-service breakdown (e.g. mlops-backend, mlops-mlflow, mlops-minio, mlops-model-server) showing Last and Max consumption.',
      },
      {
        n: 4,
        label: 'Host CPU/memory & Network by container',
        text: 'Historical host load and container network I/O over the selected window.',
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
    wireframe: (
      <ScreenshotFrame
        src={projectsImg}
        path="maia / projects"
        alt="Maia Projects page showing the Name your project field, New project button, and project cards"
        caption="Projects screen: create a project at the top or open any existing project card below."
      />
    ),
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
        text: 'Opens the project. Shows creation timestamp, Sources, Rows in gold, and the linked repository (or “No repository linked yet”).',
      },
      {
        n: 4,
        label: 'Sources',
        text: 'How many external systems are connected. Uploaded files are counted separately, under Data.',
      },
      {
        n: 5,
        label: 'Rows in gold',
        text: 'The size of the table training will read, highlighted in gold. Zero until the first gold build exists.',
      },
      {
        n: 6,
        label: 'Model and Next',
        text: 'Once the project has deployed a model the card names it. Until then, “Next” says the first thing still missing: a data source, the gold table, a repository, or a run.',
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
    title: 'Data, code, and deployment rules',
    keywords: ['project', 'detail', 'data factory', 'repository', 'link', 'deployment rules', 'accuracy', 'bar', 'run pipeline', 'overview'],
    lede: 'The project page brings together the three parts of a project: Data Factory (your data), Repository (your notebook), and Deployment rules (the quality gate a run must pass to deploy automatically).',
    wireframe: (
      <ScreenshotFrame
        src={projectDetailImg}
        path="maia / projects · prueba production"
        alt="Inside a project showing Run pipeline button, Data Factory card, linked Repository card, and Deployment rules card"
        caption="Inside a project: Data Factory, linked Repository, and Deployment rules."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Run pipeline',
        text: 'Top-right action. Opens the launch dialog to execute the linked notebook on the project’s gold table or dataset.',
      },
      {
        n: 2,
        label: 'Data Factory',
        text: 'Opens the stage-by-stage path from data connection and cleaning to the gold table, while showing live counts of Sources and Rows in gold.',
      },
      {
        n: 3,
        label: 'Repository',
        text: 'The code card. Shows the linked GitHub repository, branch, and .ipynb file, with buttons to Open pipeline or Unlink.',
      },
      {
        n: 4,
        label: 'Deployment rules',
        text: 'Configures automatic model promotion: toggle auto-deploy, choose the evaluation Metric (e.g. accuracy), comparison direction (higher ≥ or lower ≤), threshold Bar (e.g. 0.7), and whether the run must also beat the currently serving version.',
      },
    ],
    fields: [
      {
        term: 'Link a repository / Unlink',
        text: 'Attaches or removes the GitHub notebook connection. Unlinking leaves all data, gold builds, and past runs untouched.',
      },
      {
        term: 'Open pipeline',
        text: 'Appears when a repository is linked. Opens the visual pipeline canvas for that repository.',
      },
      {
        term: 'Deploy automatically when a run meets the bar',
        text: 'When checked, any successful run whose metric clears the configured bar is deployed to the model server without manual intervention.',
      },
      {
        term: '...and beat the version serving now',
        text: 'Optional stricter gate: requires the new run to outperform the currently active model version in addition to clearing the static bar.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Work top to bottom on a first visit',
        body: 'Open the Data Factory, connect something, run an extraction. Then come back for the repository and deployment rules once there is a table worth training on.',
      },
    ],
  },

  {
    id: 'my-repos',
    chapter: 'data',
    nav: 'My Repos',
    title: 'My Repos: registering a GitHub repository',
    keywords: ['my repos', 'register repository', 'github', 'webhook', 'notebook template', 'add repository', 'url'],
    lede: 'Before a project can link to a notebook, its GitHub repository must be registered in My Repos. Registering connects the repository and sets up a webhook to trigger pipelines automatically on push events.',
    wireframe: (
      <ScreenshotFrame
        src={myReposImg}
        path="maia / my repos · add a new repository"
        alt="My Repos screen showing Add a new repository form, notebook template download button, and GitHub Repository URL input"
        caption="My Repos: download the starter notebook template and register a GitHub repository URL."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Click to download the notebook template',
        text: 'Downloads a ready-to-use .ipynb file with the required MLOps cell tags (mlops:config, mlops:preprocessing, mlops:training, mlops:export) already configured.',
      },
      {
        n: 2,
        label: 'GitHub Repository URL',
        text: 'The full HTTPS address of the repository (e.g. https://github.com/user/repo) containing your training notebooks.',
      },
      {
        n: 3,
        label: 'Register Repository',
        text: 'Validates access using your GitHub token, adds the repository to your list, and creates the push webhook on GitHub.',
      },
    ],
    steps: [
      {
        title: 'Download the template if starting fresh',
        body: 'Use the template button so you do not have to create the cell metadata tags by hand.',
      },
      {
        title: 'Paste the GitHub URL and register',
        body: 'Enter https://github.com/owner/repo and click Register Repository. Once registered, the repository is available to link inside any project.',
      },
    ],
  },

  {
    id: 'link-repo',
    chapter: 'data',
    nav: 'Linking a repository',
    title: 'Repository, branch, notebook — in that order',
    keywords: ['repository', 'repo', 'github', 'link', 'branch', 'notebook', 'ipynb', 'choose', 'explore', 'template'],
    lede: 'Inside a project, linking code is three choices: pick a registered repository, choose its branch, and select the .ipynb notebook that trains on the project’s data.',
    wireframe: (
      <ScreenshotFrame
        src={linkRepoProjectImg}
        path="maia / projects · link repository"
        alt="Project page with the Repository picker expanded, showing the notebook template download link and registered repositories with Explore buttons"
        caption="Linking a repository inside a project: click Explore on a registered repository to pick its branch and notebook."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Click to download the notebook template',
        text: 'Also available directly inside the project picker if your repository still needs a compliant notebook.',
      },
      {
        n: 2,
        label: 'Registered repositories & Explore',
        text: 'Pick a repository from your registered list and click Explore to load its branches and .ipynb files from GitHub.',
      },
      {
        n: 3,
        label: 'Branch & Notebook selection',
        text: 'Choose the branch to track and the specific .ipynb file that Maia will execute on each run.',
      },
      {
        n: 4,
        label: 'Cancel',
        text: 'Closes the repository picker without changing the project’s current link.',
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
    id: 'pipelines-list',
    chapter: 'pipelines',
    nav: 'All pipelines',
    title: 'Pipelines: every run of your notebooks',
    keywords: ['pipelines', 'runs', 'search', 'filter', 'history', 'commit', 'branch', 'duration', 'cards'],
    lede: 'The Pipelines page in the sidebar is the full archive of notebook runs across your projects and repositories. Search by notebook, project, or repository and click any card to inspect its phases and logs.',
    wireframe: (
      <ScreenshotFrame
        src={pipelinesImg}
        path="maia / pipelines"
        alt="Pipelines page showing the search bar, filter button, and grid of pipeline run cards"
        caption="Pipelines screen: search and filter across every notebook execution."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Search & filter bar',
        text: 'Filter runs instantaneously by notebook filename, project name, or repository, or use the filter button on the right to narrow by status.',
      },
      {
        n: 2,
        label: 'Run card header & status',
        text: 'Displays the executed .ipynb filename, its associated project (or “No project”), and a status pill (success, failed, running, or queued).',
      },
      {
        n: 3,
        label: 'Commit, Branch, Started & Duration',
        text: 'Records the exact 7-character Git commit SHA, branch name, start timestamp, and wall-clock duration of the run.',
      },
      {
        n: 4,
        label: 'User & Repository',
        text: 'Shows who triggered the run and the full GitHub owner/repository path at the bottom of the card.',
      },
    ],
  },

  {
    id: 'pipeline-canvas',
    chapter: 'pipelines',
    nav: 'The pipeline canvas',
    title: 'Nine connected nodes: from Input to Model',
    keywords: ['pipeline', 'canvas', 'input', 'phases', 'nodes', 'notebook', 'drag', 'data', 'runs', 'runtime'],
    lede: 'The pipeline canvas maps every stage of a notebook run left to right: Input → Setup → Config → Data → Preprocessing → Training → Evaluation → Export → Model. Click any node on the canvas to inspect its code, logs, or data.',
    wireframe: (
      <ScreenshotFrame
        src={runtimePipelineImg}
        path="maia / pipelines · canvas"
        alt="Pipeline canvas showing Run pipeline button, run selector, repository selector, and the 9 connected nodes from Input to Model"
        caption="The pipeline canvas: top toolbar and the nine sequential stages of a notebook execution."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Run pipeline & Run selector',
        text: 'Top-left controls: Run pipeline launches a new execution; the adjacent dropdown (e.g. 028715c2 · success) switches between historical runs of this repository.',
      },
      {
        n: 2,
        label: 'Project / Repository switcher & Back',
        text: 'Center dropdown switches between linked projects/repositories; Back returns to the project or pipelines list.',
      },
      {
        n: 3,
        label: 'Input node',
        text: 'Shows the mounted data layer (e.g. gold v2) and its status. Clicking it opens the Medallion & dataset selector.',
      },
      {
        n: 4,
        label: 'Execution phase nodes (Setup → Export)',
        text: 'Seven notebook stage nodes (Setup, Config, Data, Preprocessing, Training, Evaluation, Export), each displaying how many cells ran and its status badge (COMPLETED, FAILED, or PENDING).',
      },
      {
        n: 5,
        label: 'Model node',
        text: 'Final node on the right showing the resulting accuracy and deployment state (e.g. accuracy 0.9462 · deployed).',
      },
      {
        n: 6,
        label: 'Zoom controls & Maia assistant',
        text: 'Bottom-left buttons zoom in (+), zoom out (−), or fit the canvas to screen; the Maia mascot at the bottom center reflects pipeline mood and status.',
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
        text: 'The entry at the top of the run selector. It shows the notebook currently on the branch before a run is selected.',
      },
    ],
    steps: [
      {
        title: 'Choose the input',
        body: 'Click the Input node to open the layer drawer, then pick a Gold, Silver, or Bronze build — or drag it onto the Input card.',
      },
      {
        title: 'Click any stage node to inspect it',
        body: 'Every stage from Setup to Export opens a side drawer with the exact Python cell executed and its step logs.',
      },
      {
        title: 'Select an older run in the top dropdown',
        body: 'The canvas redraws as that run: its commit, its phase statuses, its logs, and the model metrics it produced.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'The canvas is per repository',
        body: 'A project has one linked repository, so it has one canvas. Selecting an older run to inspect does not change the input configured for future runs.',
      },
      {
        tone: 'watch',
        title: 'One run at a time',
        body: 'The button is disabled while this repository has a queued or running pipeline. Other projects are unaffected.',
      },
    ],
  },

  {
    id: 'stage-input',
    chapter: 'pipelines',
    nav: 'Stage 1 · Input',
    title: 'Stage 1 — Input: choosing a Medallion layer or dataset',
    keywords: ['input', 'medallion', 'gold', 'silver', 'bronze', 'parquet', 'dataset_path', 'active dataset', 'stage 1'],
    lede: 'Clicking the Input node opens the data drawer, where you choose which table Maia mounts into the notebook as DATASET_PATH on the next run.',
    wireframe: (
      <ScreenshotFrame
        src={medallionsImg}
        path="maia / pipelines · stage 1: input"
        alt="Pipeline Input drawer showing IN USE NEXT RUN gold v2, GOLD builds, SILVER tables, BRONZE tables, and Use the active dataset instead"
        caption="Stage 1 (Input): pick or drag a Gold, Silver, or Bronze build, or fall back to the active uploaded dataset."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'IN USE · NEXT RUN',
        text: 'Displays the layer currently mounted as DATASET_PATH (e.g. gold v2) and its underlying MinIO Parquet URI (s3://gold/project-4/gold/v0002.parquet).',
      },
      {
        n: 2,
        label: 'GOLD builds',
        text: 'Choose gold · newest (automatically follows every new Gold build) or pin a specific version such as gold v2 or gold v1.',
      },
      {
        n: 3,
        label: 'SILVER & BRONZE · UNCLEANED',
        text: 'Allows mounting cleaned Silver tables or raw Bronze extractions per source when a notebook needs to do its own feature aggregation.',
      },
      {
        n: 4,
        label: 'Use the active dataset instead',
        text: 'Clears the medallion selection and reverts DATASET_PATH to the project’s active uploaded file.',
      },
    ],
  },

  {
    id: 'stage-setup',
    chapter: 'pipelines',
    nav: 'Stage 2 · Setup',
    title: 'Stage 2 — Setup: imports and Papermill parameters',
    keywords: ['setup', 'parameters', 'papermill', 'imports', 'dataset_path', 'model_output_path', 'pipeline_id', 'mlflow_tracking_uri', 'stage 2'],
    lede: 'The Setup node groups untagged cells and the parameters cell at the top of the notebook, where Papermill injects runtime variables before training begins.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineSetupImg}
        path="maia / pipelines · stage 2: setup"
        alt="Setup stage drawer showing the parameters cell with DATASET_PATH, MODEL_OUTPUT_PATH, PIPELINE_ID, MLFLOW_TRACKING_URI, and step logs"
        caption="Stage 2 (Setup): the parameters cell injected by Papermill at runtime."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Notebook header & breadcrumb',
        text: 'Shows the notebook filename (e.g. encounters_layer_notebook.ipynb › Setup) and the cell tag badge (parameters).',
      },
      {
        n: 2,
        label: 'Injected runtime variables',
        text: 'Declares DATASET_PATH, MODEL_OUTPUT_PATH, PIPELINE_ID, and MLFLOW_TRACKING_URI, which Maia overwrites automatically when executing the run.',
      },
      {
        n: 3,
        label: 'Execution status bar',
        text: 'Blue footer bar confirming the branch (main), cell execution status (completed · the code this run executed), cell/line count, and language.',
      },
      {
        n: 4,
        label: 'LOGS (this step)',
        text: 'Displays stdout/stderr captured specifically from the Setup cells during this run.',
      },
    ],
  },

  {
    id: 'stage-config',
    chapter: 'pipelines',
    nav: 'Stage 3 · Config',
    title: 'Stage 3 — Config: model identity and local fallbacks',
    keywords: ['config', 'mlops:config', 'model_name', 'version', 'fallback', 'stage 3'],
    lede: 'The Config node runs the cell tagged mlops:config, which names the model, sets its version string, and provides safe local defaults when running outside Maia.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineConfigImg}
        path="maia / pipelines · stage 3: config"
        alt="Config stage drawer showing mlops:config cell defining MODEL_NAME, VERSION, fallback paths, and printed step logs"
        caption="Stage 3 (Config): defines MODEL_NAME and VERSION and logs the resolved dataset path."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'MODEL_NAME and VERSION',
        text: 'Required variables read by Maia to register and version the trained artifact in MLflow (e.g. encounter-class-classifier, v1).',
      },
      {
        n: 2,
        label: 'Environment fallbacks',
        text: 'Uses "or" expressions (e.g. MODEL_OUTPUT_PATH or "./model.joblib") so the same cell runs locally on a laptop without errors.',
      },
      {
        n: 3,
        label: 'Step output in LOGS',
        text: 'Prints the resolved model identifier and temporary Parquet path mounted by the worker (/tmp/.../dataset/gold-v0002.parquet).',
      },
    ],
  },

  {
    id: 'stage-data',
    chapter: 'pipelines',
    nav: 'Stage 4 · Data',
    title: 'Stage 4 — Data: loading and inspecting the dataset',
    keywords: ['data', 'mlops:data', 'read_parquet', 'target_column', 'dataframe', 'schema', 'stage 4'],
    lede: 'The Data node executes the optional mlops:data cell, which loads the Parquet or CSV file from DATASET_PATH into a DataFrame and verifies the target column.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineDataImg}
        path="maia / pipelines · stage 4: data"
        alt="Data stage drawer showing code that checks DATASET_PATH and loads the dataset, with column types printed in the step logs"
        caption="Stage 4 (Data): reads DATASET_PATH and logs the loaded DataFrame schema."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'TARGET_COLUMN & DATASET_PATH check',
        text: 'Sets the label column to predict (e.g. encounter_class) and raises a clear error if DATASET_PATH is empty or missing.',
      },
      {
        n: 2,
        label: 'DataFrame schema in LOGS',
        text: 'Prints the loaded columns and data types (e.g. recorded_at, id, procedure_code, procedure_text) so you can verify what entered the pipeline.',
      },
    ],
  },

  {
    id: 'stage-preprocessing',
    chapter: 'pipelines',
    nav: 'Stage 5 · Preprocessing',
    title: 'Stage 5 — Preprocessing: feature engineering and splits',
    keywords: ['preprocessing', 'mlops:preprocessing', 'train_test_split', 'features', 'classes', 'stage 5'],
    lede: 'The Preprocessing node runs the required mlops:preprocessing cell, transforming raw columns into model features and splitting rows into training and test sets.',
    wireframe: (
      <ScreenshotFrame
        src={pipelinePreprocessingImg}
        path="maia / pipelines · stage 5: preprocessing"
        alt="Preprocessing stage drawer showing train_test_split code and step logs with class distribution and Train/Test row counts"
        caption="Stage 5 (Preprocessing): validates the target column, encodes features, and logs the Train / Test split sizes."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Target validation & cleaning',
        text: 'Verifies TARGET_COLUMN exists in df.columns and drops rows where the target label is null.',
      },
      {
        n: 2,
        label: 'Class balance & split logs',
        text: 'Step logs display per-class counts (e.g. home, inpatient, snf, hospice, virtual) and the final sample split (Train: 4,456 | Test: 1,115).',
      },
    ],
  },

  {
    id: 'stage-training',
    chapter: 'pipelines',
    nav: 'Stage 6 · Training',
    title: 'Stage 6 — Training: fitting the model',
    keywords: ['training', 'mlops:training', 'fit', 'randomforest', 'feature importance', 'stage 6'],
    lede: 'The Training node runs the required mlops:training cell, instantiating the estimator, fitting it on X_train and y_train, and printing training diagnostics.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineTrainingImg}
        path="maia / pipelines · stage 6: training"
        alt="Training stage drawer showing RandomForestClassifier model.fit code and feature importance values in the step logs"
        caption="Stage 6 (Training): fits the estimator and logs feature importances."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Estimator configuration & model.fit',
        text: 'Defines hyperparameters (such as n_estimators, max_depth, class_weight="balanced") and fits the model on the training split.',
      },
      {
        n: 2,
        label: 'Feature importance logs',
        text: 'Prints the top predictive features (e.g. base_cost, duration_minutes, total_claim_cost, payer_coverage) directly in the step log panel.',
      },
    ],
  },

  {
    id: 'stage-evaluation',
    chapter: 'pipelines',
    nav: 'Stage 7 · Evaluation',
    title: 'Stage 7 — Evaluation: logging metrics to MLflow',
    keywords: ['evaluation', 'mlops:evaluation', 'mlflow', 'accuracy', 'f1_score', 'classification_report', 'metrics', 'stage 7'],
    lede: 'The Evaluation node runs the mlops:evaluation cell, scoring the model on X_test and recording metrics in MLflow so Maia can evaluate the project’s deployment rules.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineEvaluationImg}
        path="maia / pipelines · stage 7: evaluation"
        alt="Evaluation stage drawer showing mlflow tracking code, accuracy/F1 calculation, and classification report in the step logs"
        caption="Stage 7 (Evaluation): computes test metrics and logs them to MLflow."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'MLflow tracking & metric calculation',
        text: 'Connects to MLFLOW_TRACKING_URI, predicts on X_test, computes accuracy and weighted F1, and logs metrics via mlflow.log_metric().',
      },
      {
        n: 2,
        label: 'Classification report & summary log',
        text: 'Outputs precision/recall/F1 averages and the final summary line (Accuracy: 0.9462 | F1 (weighted): 0.9465 | layer: gold).',
      },
    ],
  },

  {
    id: 'stage-export',
    chapter: 'pipelines',
    nav: 'Stage 8 · Export',
    title: 'Stage 8 — Export: saving the model artifact to disk',
    keywords: ['export', 'mlops:export', 'joblib', 'dump', 'model_output_path', 'artifact', 'stage 8'],
    lede: 'The Export node runs the required mlops:export cell, serializing the trained model to MODEL_OUTPUT_PATH so the worker can register and deploy it.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineExportImg}
        path="maia / pipelines · stage 8: export"
        alt="Export stage drawer showing joblib.dump(model, MODEL_OUTPUT_PATH) and the saved artifact path in step logs"
        caption="Stage 8 (Export): serializes the trained model with joblib.dump."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'joblib.dump(model, MODEL_OUTPUT_PATH)',
        text: 'Writes the fitted model object to the exact path injected by Maia. Without this call, no artifact is produced for registration.',
      },
      {
        n: 2,
        label: 'Artifact confirmation log',
        text: 'Confirms the file was written (Model saved to /tmp/.../model.joblib) before handing off to the Model registration and deployment step.',
      },
    ],
  },

  {
    id: 'stage-model',
    chapter: 'pipelines',
    nav: 'Stage 9 · Model',
    title: 'Stage 9 — Model: MLflow registration, metrics, and deployment logs',
    keywords: ['model node', 'registered in mlflow', 'deployment', 'live', 'metrics across runs', 'register', 'deploy', 'endpoint', 'stage 9'],
    lede: 'Clicking the final Model node on the canvas opens the outcome drawer: whether the artifact was registered in MLflow, whether it cleared the deployment gate to go Live, its full metric table, and the [register] and [deploy] worker logs.',
    wireframe: (
      <div className="space-y-4">
        <ScreenshotFrame
          src={pipelineModel1Img}
          path="maia / pipelines · stage 9: model (status & metrics)"
          alt="Model stage drawer top half showing Registered in MLflow Done, Accuracy 94.62%, Deployment Live, and Metrics across runs"
          caption="Model drawer (top): MLflow registration status, Live deployment badge, summary cards, and Metrics across runs."
        />
        <ScreenshotFrame
          src={pipelineModel2Img}
          path="maia / pipelines · stage 9: model (register & deploy logs)"
          alt="Model stage drawer bottom half showing the Metrics table and [register] and [deploy] step logs with the model server endpoint"
          caption="Model drawer (bottom): full metric values and the [register] and [deploy] worker logs."
        />
      </div>
    ),
    anatomy: [
      {
        n: 1,
        label: 'Registered in MLflow & Accuracy',
        text: 'Confirms the artifact is stored in MLflow (Done) and highlights the primary evaluation metric (94.62%).',
      },
      {
        n: 2,
        label: 'Deployment card',
        text: 'Shows Live when the run cleared the project’s deployment bar, with a direct link to share a public endpoint from Models.',
      },
      {
        n: 3,
        label: 'Metrics across runs',
        text: 'Lists every logged metric for the run (accuracy, f1_weighted, missing_rate, n_samples, deployed).',
      },
      {
        n: 4,
        label: '[register] & [deploy] logs',
        text: 'Shows the exact MLflow run hash created during registration and the model-server prediction endpoint where the model was deployed.',
      },
    ],
  },

  {
    id: 'running',
    chapter: 'pipelines',
    nav: 'Running a pipeline',
    title: 'Starting a run, and what happens next',
    keywords: ['run pipeline', 'start', 'trigger', 'modal', 'parameters', 'model name', 'dataset_path', 'push', 'webhook', 'queued', 'running'],
    lede: 'Clicking Run pipeline opens a launch dialog that summarizes the repository, branch, notebook, and mounted gold table, lets you name the output model, and injects optional training parameters into the notebook.',
    wireframe: (
      <ScreenshotFrame
        src={runPipelineImg}
        path="maia / run pipeline modal"
        alt="Run pipeline modal showing Model name input, Repository/Branch/Notebook/Data summary, Training parameters, and deployment rule note"
        caption="The Run pipeline dialog: confirm the model name, mounted data, and optional parameters before starting the run."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Model name',
        text: 'The identifier under which this notebook’s trained model will be registered and served (letters, digits, _, ., -). Later runs deploy new versions of this same model.',
      },
      {
        n: 2,
        label: 'Execution summary (Repository, Branch, Notebook, Data)',
        text: 'Read-only confirmation of which GitHub repository, branch, and .ipynb file will run, plus the exact Parquet build or dataset file mounted as input.',
      },
      {
        n: 3,
        label: 'Training parameters (+ Add a parameter)',
        text: 'Optional key-value overrides injected by Papermill right after the notebook’s parameters cell (numbers, booleans, or text).',
      },
      {
        n: 4,
        label: 'Deployment gate & DATASET_PATH notice',
        text: 'Reminds you of the project’s active deployment threshold (e.g. Deploys when accuracy ≥ 0.7) and notes that versions are assigned automatically.',
      },
    ],
    steps: [
      {
        title: 'Verify the summary card',
        body: 'Confirm that Repository, Branch, Notebook, and Data (for example, gold-v2-...parquet) match what you intend to train on.',
      },
      {
        title: 'Set the model name and optional parameters',
        body: 'Keep the default model name to add a new version to an existing model, or add Papermill parameters with + Add a parameter.',
      },
      {
        title: 'Choose Run',
        body: 'The run is queued immediately. A worker picks it up, executes the notebook cells, and streams logs to the run detail page.',
      },
      {
        title: 'Read the result',
        body: 'Success or failure, with metrics and (if allowed by the project’s deployment rules) an automatic deployment.',
      },
    ],
    notes: [
      {
        tone: 'tip',
        title: 'Pushing can start a run too',
        body: 'A push that changes the notebook on the linked branch triggers a run through the repository’s webhook. Use Run pipeline to repeat the same commit or test new parameters.',
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
    title: 'The record of one run: phases and live logs',
    keywords: ['run', 'detail', 'logs', 'phases', 'download', 'validate', 'execute', 'register', 'deploy', 'failed', 'metrics', 'disconnected'],
    lede: 'The run detail page is the system-level record of an execution: which commit and branch ran, which worker phase succeeded or stopped, and the console log stream.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineFailedImg}
        path="maia / pipelines · run detail"
        alt="Pipeline run detail screen showing Pipeline ID, Repo, User, Branch, Commit, failed badge, PIPELINE PHASES stepper, and Pipeline Logs panel"
        caption="Run detail screen: run metadata header, five worker phases (download to deploy), and the Pipeline Logs console."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Run header & status badge',
        text: 'Displays the Pipeline ID (e.g. 35d7eb4c-cc3), Repo, User, Branch, 7-character Commit SHA, start timestamp, duration, and overall status pill (success, failed, running, or queued).',
      },
      {
        n: 2,
        label: 'PIPELINE PHASES (download → deploy)',
        text: 'Tracks the five worker lifecycle steps: download, validate, execute, register, and deploy, with completion timestamps beneath each reached step.',
      },
      {
        n: 3,
        label: 'Pipeline Logs & connection badge',
        text: 'Streams stdout/stderr over WebSocket while the run is active and shows Disconnected once the stream closes after completion.',
      },
    ],
    fields: [
      {
        term: 'download',
        text: 'Fetches the notebook at the commit and mounts the chosen data. Fails on missing repository access or a missing file.',
      },
      {
        term: 'validate',
        text: 'Checks the four required tags. This is where “missing MLOps tags” stops the run.',
      },
      {
        term: 'execute',
        text: 'Papermill runs the notebook with DATASET_PATH and MODEL_OUTPUT_PATH injected. A Python error surfaces here.',
      },
      {
        term: 'register',
        text: 'Records the exported artifact and metrics in MLflow. A success without a model means export did not write the file.',
      },
      {
        term: 'deploy',
        text: 'Runs only if auto-deploy is on and accuracy meets the threshold. Skipping is reported as a reason, not a failure.',
      },
    ],
    steps: [
      {
        title: 'Find the last reached phase',
        body: 'Read the phase stepper from left to right. If register and deploy are greyed out, the run stopped during execute or earlier.',
      },
      {
        title: 'Inspect the logs or open the canvas',
        body: 'Read the Pipeline Logs panel here, or open the pipeline canvas to see the exact notebook cell where execution stopped.',
      },
      {
        title: 'Fix, push, run again',
        body: 'Commit the notebook change, then run again. A new run gets a new ID; the old one remains in the history.',
      },
    ],
    notes: [
      {
        tone: 'watch',
        title: 'A run can fail before the notebook',
        body: 'If the run stops at download or validate, no notebook cells were executed. Check that the repository is accessible and all four required MLOps tags exist.',
      },
      {
        tone: 'tip',
        title: 'Runs predating code capture',
        body: 'Older runs may show today’s branch code instead of the code that actually ran. The page says so; trust the commit, not the card.',
      },
    ],
  },

  {
    id: 'advisor',
    chapter: 'pipelines',
    nav: 'AI Training Advisor',
    title: 'AI Training Advisor and run metrics',
    keywords: ['advisor', 'ai', 'insights', 'analyze', 'regenerate', 'metrics', 'suggestions', 'apply', 'push', 'testing-ia-agent', 'improve'],
    lede: 'Below the logs on the run detail page sit the AI Training Advisor and the run’s Metrics table. The advisor inspects the notebook and its metrics to suggest improvements and can push an updated notebook to the testing-ia-agent branch.',
    wireframe: (
      <ScreenshotFrame
        src={pipelineAdvisorImg}
        path="maia / pipelines · ai training advisor & metrics"
        alt="AI Training Advisor section with Regenerate analysis button and Metrics table showing accuracy, f1_weighted, n_features, n_samples, and deployed"
        caption="Bottom of the run detail page: AI Training Advisor with Regenerate analysis and the run's Metrics table."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'AI TRAINING ADVISOR & Regenerate analysis',
        text: 'Displays the AI analysis for this run. Click Regenerate analysis to request a fresh report at any time (for example, if the upstream LLM provider returned a temporary 503 error).',
      },
      {
        n: 2,
        label: 'Advisor status / report panel',
        text: 'Shows the generated recommendations (or a clear provider error message if the external AI service was temporarily unavailable when the run ended).',
      },
      {
        n: 3,
        label: 'Apply & push (when a report is present)',
        text: 'Rewrites the notebook with the advisor’s recommendations while preserving required MLOps tags, and pushes the result to branch testing-ia-agent.',
      },
      {
        n: 4,
        label: 'METRICS table',
        text: 'Lists every metric recorded by the run (accuracy, f1_weighted, n_features, n_samples, and whether deployed is true or false).',
      },
    ],
    steps: [
      {
        title: 'Let it run automatically or click Regenerate analysis',
        body: 'The first analysis triggers automatically when a run finishes. If the AI provider was busy (e.g. 503 Service Unavailable), click Regenerate analysis to retry without re-running the pipeline.',
      },
      {
        title: 'Review the metrics table alongside the report',
        body: 'Check accuracy, f1_weighted, n_features, n_samples, and deployed status right below the advisor box.',
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

  {
    id: 'notebook',
    chapter: 'pipelines',
    nav: 'Notebook requirements',
    title: 'The four tags that make a notebook runnable',
    keywords: ['notebook', 'tags', 'mlops', 'config', 'preprocessing', 'training', 'export', 'joblib', 'papermill', 'contract'],
    lede: 'Maia does not read a notebook like a person. It looks for four required tags (plus optional data and evaluation tags) and runs those cells in a fixed order. Use this quick reference when tagging a notebook from scratch.',
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

  /* ---------------------------------------------------------------- */
  /*  05 — Models and account                                          */
  /* ---------------------------------------------------------------- */
  {
    id: 'models',
    chapter: 'account',
    nav: 'Models',
    title: 'What is deployed, and how to test or share it',
    keywords: ['models', 'deploy', 'endpoint', 'public link', 'share', 'predict', 'test', 'versions', 'rollback', 'delete', 'accuracy', 'inference'],
    lede: 'Models is the deployment register. A row appears after a successful run deploys; from here you can test inference payloads, generate a shareable public link, inspect or switch versions, or delete the deployment.',
    wireframe: (
      <ScreenshotFrame
        src={modelsImg}
        path="maia / models"
        alt="Models page table showing Model, User, Version, Accuracy, Deployed date, Status, Public Link, and Actions (Test, Versions, Delete)"
        caption="Models screen: active deployments, accuracy, shareable public links, and Test / Versions / Delete actions."
      />
    ),
    anatomy: [
      {
        n: 1,
        label: 'Model, User, Version & Accuracy',
        text: 'Identifies the served model name, owner, active version (e.g. v1), and validation accuracy recorded at registration.',
      },
      {
        n: 2,
        label: 'Deployed & Status',
        text: 'Timestamp of when the version was promoted and its live status badge (active means currently answering requests).',
      },
      {
        n: 3,
        label: 'Public link (Share / New link / Stop)',
        text: 'Click Share to generate an external URL for inference without requiring a Maia login. Once shared, copy the URL, rotate it with New link, or revoke it with Stop.',
      },
      {
        n: 4,
        label: 'Actions (Test, Versions, Delete)',
        text: 'Test opens an interactive JSON predictor; Versions lists all registered versions to compare or roll back; Delete unloads the model.',
      },
    ],
    fields: [
      {
        term: 'Version & Versions button',
        text: 'Deploying the same model name again registers a new version. Open Versions to inspect historical versions and switch which one is active.',
      },
      {
        term: 'Metric',
        text: 'What the model is judged on: the metric its project deploys on, as the run logged it. Accuracy reads as a percentage; any other metric as its number.',
      },
      {
        term: 'Share / Public link',
        text: 'Creates a tokenized public endpoint so external apps or teammates can call the model. Rotating (New link) or stopping (Stop) invalidates the previous public URL immediately.',
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
