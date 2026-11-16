import { Link } from 'react-router-dom';
import ManualPage, { type ManualLegendItem } from '../components/docs/ManualPage';
import { CHAPTERS, SECTIONS } from '../docs/manual';

const LEGEND: ManualLegendItem[] = [
  {
    kind: 'pin',
    label: 'Numbered item / pin',
    text: 'Lists the controls in “What you see” below each screenshot, and matches the numbered pins on schematic diagrams.',
  },
  {
    kind: 'solid',
    label: 'Solid box',
    text: 'A control or panel that exists on the screen.',
  },
  {
    kind: 'dashed',
    label: 'Dashed box',
    text: 'Optional, empty, or locked until a condition is met.',
  },
  {
    kind: 'accent',
    label: 'Highlighted box',
    text: 'The active choice — where you are in the screen.',
  },
];

export default function Docs() {
  return (
    <ManualPage
      documentTitle="User manual · Maia"
      skipLinkLabel="Skip to the manual"
      topBarTitle="User manual"
      crossLink={{
        to: '/tech-docs',
        headerLabel: 'Tech docs',
        footerLabel: 'Tech docs',
        icon: 'code',
      }}
      hero={{
        editionLabel: 'User manual · Edition 01',
        dateLabel: 'October 2026',
        headingLine1: 'How Maia works,',
        headingAccent: 'one screen at a time.',
        headingClassName: 'text-[clamp(2.6rem,7.2vw,4.9rem)]',
        lede: (
          <>
            This is the manual for the product you are looking at: what each screen is
            for, what its controls do, and what to do when a run does not go the way you
            expected. It follows the order you meet things after signing in, and it can
            be read in any order after that.
          </>
        ),
        ledeClassName: 'max-w-[34rem]',
        figureStatSrLabel: 'Screens',
        figureStatLabel: 'illustrated screens',
        legendTitle: 'How to read the screens',
        legendPinNumber: 3,
        legendItems: LEGEND,
        legendFooter: (
          <>
            Most sections show real UI screenshots paired with a numbered breakdown of
            their controls; complex multi-panel flows use schematic diagrams with matching
            numbered pins. Looking for local Docker deployment or architecture instead?
            Open the{' '}
            <Link to="/tech-docs" className="font-semibold text-[var(--accent)] underline">
              Technical documentation
            </Link>
            .
          </>
        ),
        chapterGridClassName: 'grid-cols-3 sm:grid-cols-6',
      }}
      search={{
        placeholder: 'Search the manual',
        ariaLabel: 'Search the user manual',
        sidebarEmptyHint: 'Try a screen name: dashboard, gold, invite.',
        mainEmptyHint:
          'Try the name of a screen or control: dashboard, gold, invite, Run pipeline.',
      }}
      tocAriaLabel="Manual contents"
      sectionHeadings={{
        anatomy: 'What you see',
        fields: 'What each part means',
        steps: (section) =>
          section.id === 'welcome' ? 'The shape of the work' : 'Step by step',
      }}
      footer={{
        eyebrow: 'End of manual',
        body: (
          <>
            This manual describes Maia as it behaves today. If a screen disagrees with
            it, the screen is right — and the manual needs an update.
          </>
        ),
        colophon: (count) =>
          `Maia · User manual · Edition 01 · ${count} illustrated screens`,
      }}
      chapters={CHAPTERS}
      sections={SECTIONS}
    />
  );
}
