import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUp, Printer, Search, X } from 'lucide-react';
import { CHAPTERS, SECTIONS, chapterOf, type ManualSection } from '../docs/manual';
import { Anatomy, Callout, FieldList, QaList, Steps } from '../components/docs/ManualBlocks';

/**
 * The manual is a printed artefact that happens to be a web page.
 *
 * That is why it does not use the product's dark interface: a manual is read
 * beside the thing it describes, often printed, and its job is to stay legible
 * when the screen it documents is the one that is misbehaving. Paper, ink, one
 * signal colour, and drawings made of rules.
 *
 * Its structure is the product's structure, in the order a new user meets it.
 * The numbered chapter path in the hero is the only sequence here; individual
 * sections are not numbered, because nobody reads a reference manual in a line.
 */

const ALL_SECTIONS = SECTIONS;

function matches(section: ManualSection, query: string): boolean {
  if (!query) return true;
  const haystack = [section.title, section.nav, section.lede, ...section.keywords]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

function firstSectionOf(chapterId: string): string {
  return ALL_SECTIONS.find((section) => section.chapter === chapterId)?.id ?? 'welcome';
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
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
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
        placeholder="Search the manual"
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
  sections,
  active,
  onNavigate,
  query,
}: {
  sections: ManualSection[];
  active: string;
  onNavigate: (id: string) => void;
  query: string;
}) {
  if (sections.length === 0) {
    return (
      <p className="manual-body-text py-3 text-[12px]">
        Nothing matches “{query}”. Try a screen name: dashboard, gold, invite.
      </p>
    );
  }

  return (
    <nav aria-label="Manual contents">
      {CHAPTERS.map((chapter) => {
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

function LegendMark({ kind }: { kind: 'pin' | 'solid' | 'dashed' | 'accent' }) {
  if (kind === 'pin') {
    return (
      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--accent)] font-display text-[9px] font-semibold leading-none text-slate-950 shadow-[0_0_0_2px_var(--paper-soft)]">
        3
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
    <span className={`${shape} border-[var(--rule-strong)] bg-[var(--paper-soft)]`} aria-hidden="true" />
  );
}

const LEGEND = [
  {
    kind: 'pin' as const,
    label: 'Numbered pin',
    text: 'Matches the same number in “What you see”.',
  },
  {
    kind: 'solid' as const,
    label: 'Solid box',
    text: 'A control or panel that exists on the screen.',
  },
  {
    kind: 'dashed' as const,
    label: 'Dashed box',
    text: 'Optional, empty, or locked until a condition is met.',
  },
  {
    kind: 'accent' as const,
    label: 'Indigo box',
    text: 'The active choice — where you are in the screen.',
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function Docs() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(ALL_SECTIONS[0].id);
  const mobileToc = useRef<HTMLDetailsElement>(null);

  const normalised = query.trim().toLowerCase();
  const filtered = useMemo(
    () => ALL_SECTIONS.filter((section) => matches(section, normalised)),
    [normalised],
  );
  const visibleKey = filtered.map((section) => section.id).join('|');

  useEffect(() => {
    const previous = document.title;
    document.title = 'User manual · Maia';
    return () => {
      document.title = previous;
    };
  }, []);

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

  const wireframeCount = ALL_SECTIONS.filter((section) => section.wireframe).length;

  return (
    <div id="top" className="manual min-h-screen">
      <a
        href="#manual-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:border focus:border-[var(--ink)] focus:bg-[var(--paper)] focus:px-3 focus:py-2 focus:text-sm focus:text-[var(--ink)]"
      >
        Skip to the manual
      </a>

      {/* ---- Paper top bar ------------------------------------------ */}
      <header className="manual-print-hide sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 lg:px-8">
          <Link
            to="/"
            className="group inline-flex items-center gap-2 text-[12px] font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--accent)]"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back to Maia</span>
          </Link>

          <p className="manual-eyebrow hidden normal-case tracking-[0.14em] sm:block">
            <span className="font-semibold text-[var(--ink)]">Maia</span>
            <span className="mx-2 text-[var(--rule-strong)]">/</span>
            User manual
          </p>

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
                <span className="manual-eyebrow">User manual · Edition 01</span>
                <span className="manual-eyebrow">October 2026</span>
              </div>

              <h1 className="mt-5 font-display text-[clamp(2.6rem,7.2vw,4.9rem)] font-semibold leading-[0.95] tracking-[-0.035em] text-[var(--ink)]">
                How Maia works,
                <span className="mt-1 block text-[var(--accent)]">one screen at a time.</span>
              </h1>

              <p className="manual-lede mt-6 max-w-[34rem]">
                This is the manual for the product you are looking at: what each screen is
                for, what its controls do, and what to do when a run does not go the way you
                expected. It follows the order you meet things after signing in, and it can
                be read in any order after that.
              </p>

              <dl className="mt-8 flex flex-wrap items-center gap-x-7 gap-y-2 font-display text-[10.5px] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                <div className="flex items-baseline gap-2">
                  <dt className="sr-only">Sections</dt>
                  <dd className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">
                    {ALL_SECTIONS.length}
                  </dd>
                  <dd>sections</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="sr-only">Chapters</dt>
                  <dd className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">
                    {CHAPTERS.length}
                  </dd>
                  <dd>chapters</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="sr-only">Schematics</dt>
                  <dd className="text-[13px] font-semibold tabular-nums text-[var(--ink)]">
                    {wireframeCount}
                  </dd>
                  <dd>screen schematics</dd>
                </div>
              </dl>
            </div>

            {/* The visual key is part of the manual's argument: these are drawings. */}
            <aside className="border border-[var(--rule-strong)] bg-[var(--paper-soft)]/80 p-4">
              <p className="manual-eyebrow">How to read a drawing</p>
              <dl className="mt-3 space-y-2.5">
                {LEGEND.map((item) => (
                  <div key={item.label} className="flex items-start gap-3">
                    <span className="flex h-[18px] w-6 shrink-0 items-center justify-center">
                      <LegendMark kind={item.kind} />
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
                Every screen drawing is a schematic, not a screenshot. Labels stay true when
                buttons move; pixels do not.
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
              <ol className="relative grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-6">
                {CHAPTERS.map((chapter) => (
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
              label="Search the user manual"
            />
            <p className="manual-eyebrow mb-4 mt-2">
              {normalised
                ? `${filtered.length} of ${ALL_SECTIONS.length} sections`
                : 'Contents'}
            </p>
            <Contents
              sections={filtered}
              active={active}
              onNavigate={navigate}
              query={query.trim()}
            />
          </div>
        </aside>

        <main id="manual-content" className="manual-main min-w-0">
          {/* Mobile search and contents */}
          <div className="manual-print-hide mb-8 space-y-3 lg:hidden">
            <SearchField value={query} onChange={setQuery} label="Search the user manual" />
            <details
              ref={mobileToc}
              className="group border-y border-[var(--rule)] py-2"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                <span className="manual-eyebrow">
                  {normalised
                    ? `${filtered.length} of ${ALL_SECTIONS.length} sections`
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
                  sections={filtered}
                  active={active}
                  onNavigate={navigate}
                  query={query.trim()}
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
                Try the name of a screen or control: dashboard, gold, invite, Run pipeline.
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
            {CHAPTERS.map((chapter, chapterIndex) => {
              const sections = filtered.filter((section) => section.chapter === chapter.id);
              if (sections.length === 0) return null;

              const nextChapter = CHAPTERS[chapterIndex + 1];

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
                      first={section.id === sections[0].id}
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
                <p className="manual-eyebrow">End of manual</p>
                <p className="manual-body-text mt-2 max-w-lg text-[12.5px]">
                  This manual describes Maia as it behaves today. If a screen disagrees with
                  it, the screen is right — and the manual needs an update.
                </p>
              </div>
              <div className="manual-print-hide flex flex-wrap items-center gap-2">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 border border-[var(--rule-strong)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
                >
                  <ArrowLeft size={13} aria-hidden="true" />
                  Back to Maia
                </Link>
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
            <p className="manual-eyebrow mt-8 text-[9px]">
              Maia · User manual · Edition 01 · {wireframeCount} schematics
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One section                                                       */
/* ------------------------------------------------------------------ */

function SectionView({ section, first }: { section: ManualSection; first: boolean }) {
  const chapter = chapterOf(section);

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
          <h4 className="manual-eyebrow mb-0 mt-7">What you see</h4>
          <Anatomy items={section.anatomy} />
        </>
      )}

      {section.extra && <div className="mt-6">{section.extra}</div>}

      {section.steps && (
        <>
          <h4 className="manual-eyebrow mb-0 mt-7">
            {section.id === 'welcome' ? 'The shape of the work' : 'Step by step'}
          </h4>
          <Steps items={section.steps} />
        </>
      )}

      {section.fields && (
        <>
          <h4 className="manual-eyebrow mb-0 mt-7">What each part means</h4>
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
          <h4 className="manual-eyebrow mb-0 mt-7">Questions and answers</h4>
          <QaList items={section.qa} />
        </>
      )}
    </section>
  );
}
