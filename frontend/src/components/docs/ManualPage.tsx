import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Code2,
  Printer,
  Search,
  X,
} from 'lucide-react';
import { Anatomy, Callout, FieldList, QaList, Steps } from './ManualBlocks';
import BackLink from '../BackLink';

export interface ManualPageChapter {
  id: string;
  number: string;
  title: string;
  blurb: string;
}

export interface ManualPageSection {
  id: string;
  chapter: string;
  nav: string;
  title: string;
  lede: string;
  keywords: string[];
  wireframe?: ReactNode;
  anatomy?: { n: number; label: string; text: ReactNode }[];
  steps?: { title: string; body: ReactNode }[];
  fields?: { term: string; text: ReactNode }[];
  notes?: { tone?: 'tip' | 'watch'; title?: string; body: ReactNode }[];
  qa?: { q: string; a: ReactNode }[];
  extra?: ReactNode;
}

export type LegendMarkKind = 'pin' | 'solid' | 'dashed' | 'accent';

export interface ManualLegendItem {
  kind: LegendMarkKind;
  label: string;
  text: ReactNode;
}

export interface ManualPageProps {
  documentTitle: string;
  skipLinkLabel: string;
  topBarTitle: string;
  crossLink: {
    to: string;
    headerLabel: string;
    footerLabel: string;
    icon: 'book' | 'code';
  };
  hero: {
    editionLabel: string;
    dateLabel: string;
    headingLine1: string;
    headingAccent: string;
    headingClassName?: string;
    lede: ReactNode;
    ledeClassName?: string;
    figureStatSrLabel: string;
    figureStatLabel: string;
    legendTitle: string;
    legendPinNumber?: number;
    legendItems: ManualLegendItem[];
    legendFooter: ReactNode;
    chapterGridClassName: string;
  };
  search: {
    placeholder: string;
    ariaLabel: string;
    sidebarEmptyHint: string;
    mainEmptyHint: string;
  };
  tocAriaLabel: string;
  sectionHeadings: {
    anatomy: string;
    fields: string;
    steps?: (section: ManualPageSection) => string;
    qa?: string;
  };
  footer: {
    eyebrow: string;
    body: ReactNode;
    colophon: (figureCount: number) => string;
  };
  chapters: ManualPageChapter[];
  sections: ManualPageSection[];
}

function matches(section: ManualPageSection, query: string): boolean {
  if (!query) return true;
  const haystack = [section.title, section.nav, section.lede, ...section.keywords]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/* ------------------------------------------------------------------ */
/*  Search                                                            */
/* ------------------------------------------------------------------ */

function SearchField({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search
        size={13}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-[var(--ink-3)]"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full appearance-none border-0 border-b border-[var(--rule-strong)] bg-transparent py-2 pl-5 pr-6 text-[13px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-3)] focus:border-[var(--accent)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Contents                                                          */
/* ------------------------------------------------------------------ */

function Contents({
  chapters,
  sections,
  active,
  onNavigate,
  query,
  emptyHint,
  ariaLabel,
}: {
  chapters: ManualPageChapter[];
  sections: ManualPageSection[];
  active: string;
  onNavigate: (id: string) => void;
  query: string;
  emptyHint: string;
  ariaLabel: string;
}) {
  if (sections.length === 0) {
    return (
      <p className="manual-body-text py-3 text-[12px]">
        Nothing matches “{query}”. {emptyHint}
      </p>
    );
  }

  return (
    <nav aria-label={ariaLabel}>
      {chapters.map((chapter) => {
        const items = sections.filter((section) => section.chapter === chapter.id);
        if (items.length === 0) return null;

        return (
          <div key={chapter.id} className="mb-5 last:mb-0">
            <p className="manual-eyebrow mb-1.5 flex items-baseline gap-2 normal-case tracking-[0.1em]">
              <span className="text-[var(--accent)]">{chapter.number}</span>
              <span>{chapter.title}</span>
            </p>
            <ul className="border-l border-[var(--rule)]">
              {items.map((section) => {
                const isActive = section.id === active;
                return (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onNavigate(section.id);
                      }}
                      aria-current={isActive ? 'location' : undefined}
                      className={`-ml-px block border-l py-1 pl-3 pr-1 text-[12.5px] leading-snug transition-colors ${
                        isActive
                          ? 'border-[var(--accent)] font-medium text-[var(--ink)]'
                          : 'border-transparent text-[var(--ink-3)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {section.nav}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero legend                                                       */
/* ------------------------------------------------------------------ */

function LegendMark({ kind, pinNumber = 3 }: { kind: LegendMarkKind; pinNumber?: number }) {
  if (kind === 'pin') {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--accent)] font-display text-[9px] font-semibold leading-none text-slate-950 shadow-[0_0_0_2px_var(--paper-soft)]">
        {pinNumber}
      </span>
    );
  }

  const shape = 'h-[14px] w-6 rounded-[1px] border';
  if (kind === 'accent') {
    return (
      <span
        className={`${shape} border-[var(--accent)] bg-[var(--accent-soft)]`}
        aria-hidden="true"
      />
    );
  }
  if (kind === 'dashed') {
    return (
      <span
        className={`${shape} border-dashed border-[var(--rule-strong)] bg-transparent`}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className={`${shape} border-[var(--rule-strong)] bg-[var(--paper-soft)]`}
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Shared Manual / TechDocs Page                                     */
/* ------------------------------------------------------------------ */

export default function ManualPage({
  documentTitle,
  skipLinkLabel,
  topBarTitle,
  crossLink,
  hero,
  search,
  tocAriaLabel,
  sectionHeadings,
  footer,
  chapters,
  sections: allSections,
}: ManualPageProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(allSections[0]?.id ?? '');
  const mobileToc = useRef<HTMLDetailsElement>(null);

  const normalised = query.trim().toLowerCase();
  const filtered = useMemo(
    () => allSections.filter((section) => matches(section, normalised)),
    [allSections, normalised],
  );
  const visibleKey = filtered.map((section) => section.id).join('|');

  function firstSectionOf(chapterId: string): string {
    return (
      allSections.find((section) => section.chapter === chapterId)?.id ??
      allSections[0]?.id ??
      ''
    );
  }

  function chapterOf(section: ManualPageSection): ManualPageChapter {
    return chapters.find((chapter) => chapter.id === section.chapter) ?? chapters[0];
  }

  useEffect(() => {
    const previous = document.title;
    document.title = documentTitle;
    return () => {
      document.title = previous;
    };
  }, [documentTitle]);

  // Keep the contents honest while filtering, and remember a deep link.
  useEffect(() => {
    setActive(filtered[0]?.id ?? '');
    if (normalised) return;

    const hash = window.location.hash.replace('#', '');
    if (!hash) return;
    const target = document.getElementById(hash);
    if (!target) return;

    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
    // filtered is represented by visibleKey so a new array identity is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalised, visibleKey]);

  // Scroll spy: whichever section is crossing the top band is the one being read.
  useEffect(() => {
    if (!visibleKey) return;

    const elements = visibleKey
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (entering[0]) setActive(entering[0].target.id);
      },
      { rootMargin: '-96px 0px -62% 0px', threshold: 0 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [visibleKey]);

  function navigate(id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    setActive(id);
    window.history.replaceState(null, '', `#${id}`);
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
    if (mobileToc.current) mobileToc.current.open = false;
  }

  const figureCount = allSections.filter((section) => section.wireframe).length;
  const CrossLinkIcon = crossLink.icon === 'code' ? Code2 : BookOpen;

  return (
    <div id="top" className="manual min-h-screen">
      <a
        href="#manual-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-[var(--ink)] focus:bg-[var(--paper)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--ink)]"
      >
        {skipLinkLabel}
      </a>

      {/* ---- Paper top bar ------------------------------------------ */}
      <header className="manual-print-hide sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 lg:px-8">
          <BackLink to="/">Back to Maia</BackLink>

          <p className="manual-eyebrow hidden normal-case tracking-[0.14em] sm:block">
            <span className="font-semibold text-[var(--ink)]">Maia</span>
            <span className="mx-2 text-[var(--rule-strong)]">/</span>
            {topBarTitle}
          </p>

          <div className="flex items-center gap-2">
            <Link
              to={crossLink.to}
              className="inline-flex items-center gap-1.5 border border-[var(--rule-strong)] bg-[var(--paper-soft)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
            >
              <CrossLinkIcon size={13} aria-hidden="true" />
              <span>{crossLink.headerLabel}</span>
            </Link>

            <button
              type="button"
              onClick={() => window.print()}
              title="Print, or choose Save as PDF in the print dialog"
              className="inline-flex items-center gap-2 border border-[var(--rule-strong)] bg-[var(--paper-soft)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
            >
              <Printer size={13} aria-hidden="true" />
              Print
              <span className="hidden font-display text-[10px] font-normal text-[var(--ink-3)] sm:inline">
                / PDF
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Cover -------------------------------------------------- */}
      <section className="manual-hero relative overflow-hidden border-b border-[var(--rule-strong)]">
        <div
          aria-hidden="true"
          className="manual-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-12 lg:px-8 lg:pb-12 lg:pt-16">
          <div className="grid gap-10 lg:grid-cols-[1.55fr_0.9fr] lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="manual-eyebrow text-[var(--ink-2)]">Maia</span>
                <span aria-hidden="true" className="h-px w-8 bg-[var(--rule-strong)]" />
                <span className="manual-eyebrow">{hero.editionLabel}</span>
                <span className="manual-eyebrow">{hero.dateLabel}</span>
              </div>

              <h1
                className={`mt-5 font-display ${
                  hero.headingClassName ?? 'text-[clamp(2.6rem,7.2vw,4.9rem)]'
                } font-semibold leading-[0.95] tracking-[-0.035em] text-[var(--ink)]`}
              >
                {hero.headingLine1}
                <span className="mt-1 block text-[var(--accent)]">
                  {hero.headingAccent}
                </span>
              </h1>

              <p className={`manual-lede mt-6 ${hero.ledeClassName ?? 'max-w-[34rem]'}`}>
                {hero.lede}
              </p>

              <dl className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-2 font-display text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                <div className="flex items-baseline gap-2">
                  <dt className="sr-only">Sections</dt>
                  <dd className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">
                    {allSections.length}
                  </dd>
                  <dd>sections</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="sr-only">Chapters</dt>
                  <dd className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">
                    {chapters.length}
                  </dd>
                  <dd>chapters</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="sr-only">{hero.figureStatSrLabel}</dt>
                  <dd className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">
                    {figureCount}
                  </dd>
                  <dd>{hero.figureStatLabel}</dd>
                </div>
              </dl>
            </div>

            <aside className="border border-[var(--rule-strong)] bg-[var(--paper-soft)]/80 p-4">
              <p className="manual-eyebrow">{hero.legendTitle}</p>
              <dl className="mt-3 space-y-2.5">
                {hero.legendItems.map((item) => (
                  <div key={item.label} className="flex items-start gap-3">
                    <span className="flex h-[18px] w-6 shrink-0 items-center justify-center">
                      <LegendMark kind={item.kind} pinNumber={hero.legendPinNumber} />
                    </span>
                    <div>
                      <dt className="text-[12px] font-semibold leading-tight text-[var(--ink)]">
                        {item.label}
                      </dt>
                      <dd className="manual-body-text mt-0.5 text-[11.5px] leading-snug">
                        {item.text}
                      </dd>
                    </div>
                  </div>
                ))}
              </dl>
              <p className="manual-body-text mt-4 border-t border-[var(--rule)] pt-3 text-[11.5px] leading-snug">
                {hero.legendFooter}
              </p>
            </aside>
          </div>

          {/* ---- Chapter path --------------------------------------- */}
          <nav aria-label="Chapters" className="mt-11">
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 top-[13px] hidden h-px bg-[var(--rule-strong)] sm:block"
              />
              <ol className={`relative grid gap-x-3 gap-y-5 ${hero.chapterGridClassName}`}>
                {chapters.map((chapter) => (
                  <li key={chapter.id}>
                    <a
                      href={`#${firstSectionOf(chapter.id)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        navigate(firstSectionOf(chapter.id));
                      }}
                      className="group flex flex-col items-start"
                    >
                      <span className="flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[var(--rule-strong)] bg-[var(--paper)] font-display text-[10px] font-semibold text-[var(--ink-2)] transition-colors group-hover:border-[var(--accent)] group-hover:bg-[var(--accent)] group-hover:text-slate-950">
                        {chapter.number}
                      </span>
                      <span className="mt-2 font-display text-[9.5px] uppercase leading-tight tracking-[0.11em] text-[var(--ink-2)] transition-colors group-hover:text-[var(--accent)]">
                        {chapter.title}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>
        </div>
      </section>

      {/* ---- Contents + article ------------------------------------ */}
      <div className="manual-shell mx-auto grid max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:gap-14 lg:px-8 lg:py-14">
        <aside className="manual-print-hide hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6.5rem)] overflow-y-auto pb-8 pr-2">
            <SearchField
              value={query}
              onChange={setQuery}
              label={search.ariaLabel}
              placeholder={search.placeholder}
            />
            <p className="manual-eyebrow mb-4 mt-2">
              {normalised
                ? `${filtered.length} of ${allSections.length} sections`
                : 'Contents'}
            </p>
            <Contents
              chapters={chapters}
              sections={filtered}
              active={active}
              onNavigate={navigate}
              query={query.trim()}
              emptyHint={search.sidebarEmptyHint}
              ariaLabel={tocAriaLabel}
            />
          </div>
        </aside>

        <main id="manual-content" className="manual-main min-w-0">
          {/* Mobile search and contents */}
          <div className="manual-print-hide mb-8 space-y-3 lg:hidden">
            <SearchField
              value={query}
              onChange={setQuery}
              label={search.ariaLabel}
              placeholder={search.placeholder}
            />
            <details
              ref={mobileToc}
              className="group border-y border-[var(--rule)] py-2"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span className="manual-eyebrow">
                  {normalised
                    ? `${filtered.length} of ${allSections.length} sections`
                    : 'Contents'}
                </span>
                <span className="flex items-center gap-1 font-display text-[10px] uppercase tracking-[0.1em] text-[var(--ink-3)]">
                  Open
                  <span className="text-[13px] leading-none transition-transform group-open:rotate-90">
                    ›
                  </span>
                </span>
              </summary>
              <div className="pb-2 pt-4">
                <Contents
                  chapters={chapters}
                  sections={filtered}
                  active={active}
                  onNavigate={navigate}
                  query={query.trim()}
                  emptyHint={search.sidebarEmptyHint}
                  ariaLabel={tocAriaLabel}
                />
              </div>
            </details>
          </div>

          {filtered.length === 0 && (
            <div className="border-y border-[var(--rule)] py-16 text-center">
              <p className="font-display text-xl font-semibold text-[var(--ink)]">
                Nothing matches “{query.trim()}”.
              </p>
              <p className="manual-body-text mx-auto mt-2 max-w-sm text-sm">
                {search.mainEmptyHint}
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-5 border border-[var(--rule-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
              >
                Clear search
              </button>
            </div>
          )}

          <article>
            {chapters.map((chapter, chapterIndex) => {
              const sections = filtered.filter((section) => section.chapter === chapter.id);
              if (sections.length === 0) return null;

              const nextChapter = chapters[chapterIndex + 1];

              return (
                <div key={chapter.id} className="manual-chapter">
                  <header className="pb-6">
                    <div className="flex items-start gap-4">
                      <span className="mt-[7px] shrink-0 font-display text-[11px] font-semibold tabular-nums text-[var(--accent)]">
                        {chapter.number}
                      </span>
                      <div className="min-w-0">
                        <h2 className="font-display text-[26px] font-semibold leading-none tracking-[-0.02em] text-[var(--ink)] sm:text-[30px]">
                          {chapter.title}
                        </h2>
                        <p className="manual-body-text mt-2 max-w-xl text-[13.5px]">
                          {chapter.blurb}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 h-px w-full bg-[var(--ink)]" aria-hidden="true" />
                  </header>

                  {sections.map((section) => (
                    <SectionView
                      key={section.id}
                      section={section}
                      chapter={chapterOf(section)}
                      first={section.id === sections[0].id}
                      headings={sectionHeadings}
                    />
                  ))}

                  <div className="manual-print-hide mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--rule-strong)] pt-3">
                    <span className="manual-eyebrow">
                      {chapter.number} · {chapter.title}
                    </span>
                    {nextChapter ? (
                      <a
                        href={`#${firstSectionOf(nextChapter.id)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          navigate(firstSectionOf(nextChapter.id));
                        }}
                        className="group inline-flex items-center gap-2 text-[12px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--accent)]"
                      >
                        Next chapter · {nextChapter.title}
                        <ArrowRight
                          size={13}
                          aria-hidden="true"
                          className="transition-transform group-hover:translate-x-0.5"
                        />
                      </a>
                    ) : (
                      <a
                        href="#top"
                        onClick={(event) => {
                          event.preventDefault();
                          navigate('top');
                        }}
                        className="group inline-flex items-center gap-2 text-[12px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--accent)]"
                      >
                        Back to the cover
                        <ArrowUp
                          size={13}
                          aria-hidden="true"
                          className="transition-transform group-hover:-translate-y-0.5"
                        />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </article>

          <footer className="mt-16 border-t border-[var(--ink)] pt-5">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="manual-eyebrow">{footer.eyebrow}</p>
                <p className="manual-body-text mt-2 max-w-lg text-[12.5px]">
                  {footer.body}
                </p>
              </div>
              <div className="manual-print-hide flex flex-wrap items-center gap-2">
                <Link
                  to={crossLink.to}
                  className="inline-flex items-center gap-2 border border-[var(--rule-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
                >
                  <CrossLinkIcon size={13} aria-hidden="true" />
                  {crossLink.footerLabel}
                </Link>
                <BackLink to="/">Back to Maia</BackLink>
                <button
                  type="button"
                  onClick={() => navigate('top')}
                  className="inline-flex items-center gap-2 bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--paper)] transition-opacity hover:opacity-85"
                >
                  Back to the cover
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
            <p className="manual-eyebrow mt-8 text-[9px]">{footer.colophon(figureCount)}</p>
          </footer>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One section                                                       */
/* ------------------------------------------------------------------ */

function SectionView({
  section,
  chapter,
  first,
  headings,
}: {
  section: ManualPageSection;
  chapter: ManualPageChapter;
  first: boolean;
  headings: ManualPageProps['sectionHeadings'];
}) {
  const stepsTitle = headings.steps ? headings.steps(section) : 'Step by step';

  return (
    <section
      id={section.id}
      className={`manual-section scroll-mt-24 ${
        first ? 'pt-1' : 'mt-12 border-t border-[var(--rule)] pt-9'
      }`}
    >
      <p className="manual-eyebrow">
        {chapter.number} / {chapter.title}
      </p>
      <h3 className="mt-2 font-display text-[clamp(1.55rem,3.4vw,2.05rem)] font-semibold leading-[1.1] tracking-[-0.025em] text-[var(--ink)]">
        {section.title}
      </h3>
      <p className="manual-lede mt-3">{section.lede}</p>

      {section.wireframe && <div className="mt-6">{section.wireframe}</div>}

      {section.anatomy && (
        <>
          <h4 className="manual-eyebrow mb-0 mt-7">{headings.anatomy}</h4>
          <Anatomy items={section.anatomy} />
        </>
      )}

      {section.extra && <div className="mt-6">{section.extra}</div>}

      {section.steps && (
        <>
          <h4 className="manual-eyebrow mb-0 mt-7">{stepsTitle}</h4>
          <Steps items={section.steps} />
        </>
      )}

      {section.fields && (
        <>
          <h4 className="manual-eyebrow mb-0 mt-7">{headings.fields}</h4>
          <FieldList items={section.fields} />
        </>
      )}

      {section.notes?.map((note, index) => (
        <Callout key={`${section.id}-note-${index}`} tone={note.tone} title={note.title}>
          {note.body}
        </Callout>
      ))}

      {section.qa && (
        <>
          <h4 className="manual-eyebrow mb-0 mt-7">
            {headings.qa ?? 'Questions and answers'}
          </h4>
          <QaList items={section.qa} />
        </>
      )}
    </section>
  );
}
