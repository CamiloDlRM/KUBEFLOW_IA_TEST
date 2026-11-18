import { Link } from 'react-router-dom';
import ManualPage, { type ManualLegendItem } from '../components/docs/ManualPage';
import { TECH_CHAPTERS, TECH_SECTIONS } from '../docs/techManual';

const LEGEND: ManualLegendItem[] = [
  {
    kind: 'pin',
    label: 'Numbered pin',
    text: 'Matches the numbered item in “Architecture breakdown” below the diagram.',
  },
  {
    kind: 'solid',
    label: 'Solid box',
    text: 'An active container, datastore, or runtime stage in the Compose stack.',
  },
  {
    kind: 'dashed',
    label: 'Dashed box',
    text: 'A one-shot bootstrap container or optional automated branch action.',
  },
  {
    kind: 'accent',
    label: 'Highlighted box',
    text: 'The primary coordinator or entry point of that subsystem.',
  },
];

export default function TechDocs() {
  return (
    <ManualPage
      documentTitle="Technical documentation · Maia"
      skipLinkLabel="Skip to technical documentation"
      topBarTitle="Technical documentation"
      crossLink={{
        to: '/user-manual',
        headerLabel: 'User manual',
        footerLabel: 'User manual',
        icon: 'book',
      }}
      hero={{
        editionLabel: 'Technical documentation · Edition 01',
        dateLabel: 'October 2026',
        headingLine1: 'How Maia is built,',
        headingAccent: 'from local Docker to AI agents.',
        headingClassName: 'text-[clamp(2.5rem,6.8vw,4.6rem)]',
        lede: (
          <>
            This reference covers how to deploy the entire platform on your local
            machine, how its 19 services (17 long-running containers + 2 one-shot init
            containers) communicate over Docker Compose, and how every technology in the
            frontend, backend, worker, ML lifecycle, and observability layers fits
            together.
          </>
        ),
        ledeClassName: 'max-w-[35rem]',
        figureStatSrLabel: 'Blueprints',
        figureStatLabel: 'architecture blueprints',
        legendTitle: 'How to read the blueprints',
        legendPinNumber: 2,
        legendItems: LEGEND,
        legendFooter: (
          <>
            Looking for screen-by-screen UI instructions instead? Open the{' '}
            <Link to="/user-manual" className="font-semibold text-[var(--accent)] underline">
              User manual
            </Link>
            .
          </>
        ),
        chapterGridClassName: 'grid-cols-2 sm:grid-cols-5',
      }}
      search={{
        placeholder: 'Search technical docs',
        ariaLabel: 'Search technical documentation',
        sidebarEmptyHint:
          'Try a service or package name: docker, mlflow, duckdb, grafana.',
        mainEmptyHint:
          'Try a technology, port, or variable: docker, fastapi, celery, duckdb, mlflow, grafana.',
      }}
      tocAriaLabel="Technical documentation contents"
      sectionHeadings={{
        anatomy: 'Architecture breakdown',
        fields: 'Technical components',
      }}
      footer={{
        eyebrow: 'End of technical documentation',
        body: (
          <>
            This reference documents Maia’s container architecture, deployment
            configuration, and software stack. For screen-by-screen workflows, switch
            to the User manual.
          </>
        ),
        colophon: (count) =>
          `Maia · Technical documentation · Edition 01 · ${count} architecture blueprints`,
      }}
      chapters={TECH_CHAPTERS}
      sections={TECH_SECTIONS}
    />
  );
}
